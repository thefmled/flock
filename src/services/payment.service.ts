import { prisma } from '../config/database';
import { createRazorpayOrder, calculateFees, verifyPaymentSignature, initiateRefund, fetchRazorpayPayment } from '../integrations/razorpay';
import { generateGstInvoice } from '../integrations/cleartax';
import { generateTxnRef, generateInvoiceNumber } from '../utils/txnRef';
import { AppError } from '../middleware/errorHandler';
import { Notify } from '../integrations/notifications';
import { PaymentType, PaymentStatus, OrderType } from '@prisma/client';
import { completeQueueEntry } from './queue.service';
import { selectBillableOrders } from './order.service';

// ── Initiate deposit payment for pre-order ────────────────────────

export async function initiateDeposit(params: {
  venueId:      string;
  queueEntryId: string;
  orderId:      string;
}) {
  const [entry, order, venue] = await Promise.all([
    prisma.queueEntry.findFirst({ where: { id: params.queueEntryId, venueId: params.venueId } }),
    prisma.order.findFirst({ where: { id: params.orderId, venueId: params.venueId, type: OrderType.PRE_ORDER } }),
    prisma.venue.findUnique({ where: { id: params.venueId } }),
  ]);

  if (!entry) throw new AppError('Queue entry not found', 404);
  if (!order) throw new AppError('Pre-order not found', 404);
  if (!venue) throw new AppError('Venue not found', 404);

  const depositAmount = Math.round(order.totalIncGst * venue.depositPercent / 100);
  const txnRef        = generateTxnRef();
  const fees          = calculateFees(depositAmount);

  const rzpOrder = await createRazorpayOrder({
    amount:  depositAmount,
    receipt: txnRef,
    notes: {
      venueId:      params.venueId,
      queueEntryId: params.queueEntryId,
      orderId:      params.orderId,
      type:         'DEPOSIT',
    },
  });

  const payment = await prisma.payment.create({
    data: {
      venueId:          params.venueId,
      orderId:          params.orderId,
      type:             PaymentType.DEPOSIT,
      status:           PaymentStatus.PENDING,
      amount:           depositAmount,
      platformFeeAmount: fees.platformFee,
      razorpayFeeAmount: fees.razorpayFee,
      netToVenue:       fees.netToVenue,
      razorpayOrderId:  rzpOrder.id,
      txnRef,
    },
  });

  return {
    paymentId:      payment.id,
    txnRef,
    amount:         depositAmount,
    depositPercent: venue.depositPercent,
    totalOrderValue: order.totalIncGst,
    balanceAtTable: order.totalIncGst - depositAmount,
    razorpayOrderId: rzpOrder.id,
    currency:       'INR',
    keyId:          process.env.RAZORPAY_KEY_ID ?? 'mock_key',
  };
}

// ── Capture deposit after Razorpay callback ───────────────────────

export async function captureDeposit(params: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}) {
  const payment = await capturePaymentByOrder({
    razorpayOrderId: params.razorpayOrderId,
    razorpayPaymentId: params.razorpayPaymentId,
    razorpaySignature: params.razorpaySignature,
    expectedType: PaymentType.DEPOSIT,
  });

  return { txnRef: payment.txnRef, status: 'captured', amount: payment.amount };
}

// ── Final payment at checkout ─────────────────────────────────────

export async function initiateFinalPayment(params: {
  venueId:      string;
  queueEntryId: string;
}) {
  const bill = await getBillSummary(params.queueEntryId);
  if (bill.balanceDue <= 0) throw new AppError('No balance due — bill already settled', 400);

  const txnRef = generateTxnRef();
  const fees   = calculateFees(bill.balanceDue);

  // Find the primary order to attach the final payment to
  const orders = await prisma.order.findMany({ where: { queueEntryId: params.queueEntryId } });
  const billableOrders = selectBillableOrders(orders);
  const mainOrder = billableOrders[0];
  if (!mainOrder) throw new AppError('No orders found for this entry', 404);

  const rzpOrder = await createRazorpayOrder({
    amount:  bill.balanceDue,
    receipt: txnRef,
    notes:   { venueId: params.venueId, queueEntryId: params.queueEntryId, type: 'FINAL' },
  });

  await prisma.payment.create({
    data: {
      venueId:          params.venueId,
      orderId:          mainOrder.id,
      type:             PaymentType.FINAL,
      status:           PaymentStatus.PENDING,
      amount:           bill.balanceDue,
      platformFeeAmount: 0,  // Platform fee only on pre-orders
      razorpayFeeAmount: fees.razorpayFee,
      netToVenue:       bill.balanceDue - fees.razorpayFee,
      razorpayOrderId:  rzpOrder.id,
      txnRef,
    },
  });

  return {
    txnRef,
    amount: bill.balanceDue,
    razorpayOrderId: rzpOrder.id,
    currency: 'INR',
    keyId: process.env.RAZORPAY_KEY_ID ?? 'mock_key',
  };
}

export async function captureFinalPayment(params: {
  razorpayOrderId:  string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}) {
  const payment = await capturePaymentByOrder({
    razorpayOrderId: params.razorpayOrderId,
    razorpayPaymentId: params.razorpayPaymentId,
    razorpaySignature: params.razorpaySignature,
    expectedType: PaymentType.FINAL,
  });

  return { txnRef: payment.txnRef, status: 'captured' };
}

export async function capturePaymentFromWebhook(params: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
}) {
  const payment = await prisma.payment.findFirst({
    where: { razorpayOrderId: params.razorpayOrderId },
  });
  if (!payment) throw new AppError('Payment record not found', 404);

  await capturePaymentByOrder({
    razorpayOrderId: params.razorpayOrderId,
    razorpayPaymentId: params.razorpayPaymentId,
    expectedType: payment.type,
    skipSignatureVerification: true,
  });
}

// ── Refund ────────────────────────────────────────────────────────

export async function refundDeposit(params: { paymentId: string; venueId: string; reason?: string }) {
  const payment = await prisma.payment.findFirst({
    where: { id: params.paymentId, venueId: params.venueId, type: PaymentType.DEPOSIT, status: PaymentStatus.CAPTURED },
  });
  if (!payment) throw new AppError('Eligible deposit payment not found', 404);
  if (!payment.razorpayPaymentId) throw new AppError('No Razorpay payment ID on record', 400);

  const result = await initiateRefund({ paymentId: payment.razorpayPaymentId, amount: payment.amount });
  await prisma.payment.update({
    where: { id: payment.id },
    data:  { status: PaymentStatus.REFUNDED, refundedAt: new Date(), refundAmount: payment.amount },
  });
  return { refundId: result.id, amount: payment.amount, status: 'refunded' };
}

export async function settleFinalOffline(params: { venueId: string; queueEntryId: string; staffId: string }) {
  const bill = await getBillSummary(params.queueEntryId);
  const orders = await prisma.order.findMany({
    where: { queueEntryId: params.queueEntryId },
    orderBy: { createdAt: 'asc' },
  });
  const billableOrders = selectBillableOrders(orders);
  const mainOrder = billableOrders[0];
  if (!mainOrder) throw new AppError('No orders found for this entry', 404);

  const existingFinal = await prisma.payment.findFirst({
    where: {
      venueId: params.venueId,
      orderId: mainOrder.id,
      type: PaymentType.FINAL,
      status: PaymentStatus.CAPTURED,
    },
  });

  if (!existingFinal) {
    await prisma.payment.create({
      data: {
        venueId: params.venueId,
        orderId: mainOrder.id,
        type: PaymentType.FINAL,
        status: PaymentStatus.CAPTURED,
        amount: bill.balanceDue,
        platformFeeAmount: 0,
        razorpayFeeAmount: 0,
        netToVenue: bill.balanceDue,
        txnRef: generateTxnRef(),
        upiApp: 'OFFLINE_SETTLED',
        capturedAt: new Date(),
      },
    });
  }

  await completeQueueEntry(params.queueEntryId);
  await issueFinalInvoice(params.queueEntryId, params.venueId);

  return {
    status: 'captured',
    mode: 'offline',
    amount: bill.balanceDue,
    queueEntryId: params.queueEntryId,
    settledBy: params.staffId,
  };
}

// ── GST Invoice ───────────────────────────────────────────────────

async function issueFinalInvoice(queueEntryId: string, venueId: string): Promise<void> {
  const [entry, venue, orders] = await Promise.all([
    prisma.queueEntry.findUnique({ where: { id: queueEntryId } }),
    prisma.venue.findUnique({ where: { id: venueId } }),
    prisma.order.findMany({
      where: { queueEntryId, status: { notIn: ['CANCELLED'] } },
      include: { items: true },
    }),
  ]);
  if (!entry || !venue || orders.length === 0) return;
  const existingInvoice = await prisma.invoice.findUnique({ where: { orderId: orders[0].id } });
  if (existingInvoice) return;

  const allItems = orders.flatMap(o => o.items);
  const subtotal = allItems.reduce((s, i) => s + i.subtotal, 0);
  const cgst     = allItems.reduce((s, i) => s + Math.round(i.gstAmount / 2), 0);
  const sgst     = allItems.reduce((s, i) => s + (i.gstAmount - Math.round(i.gstAmount / 2)), 0);
  const total    = subtotal + cgst + sgst;

  // Get next invoice sequence
  const count = await prisma.invoice.count({ where: { venueId } });
  const invoiceNumber = generateInvoiceNumber(count + 1);

  const result = await generateGstInvoice({
    invoiceNumber, venueGstin: venue.gstin ?? '', venueName: venue.name, venueAddress: venue.address,
    guestName: entry.guestName, guestPhone: entry.guestPhone,
    subtotal, cgst, sgst, total, issuedAt: new Date(),
    items: allItems.map(i => ({
      name: i.name, quantity: i.quantity, priceExGst: i.priceExGst, gstPercent: i.gstPercent,
      totalExGst: i.subtotal, gstAmount: i.gstAmount, total: i.totalIncGst,
    })),
  });

  await prisma.invoice.create({
    data: {
      orderId:       orders[0].id,
      venueId,
      invoiceNumber,
      irn:           result.irn,
      qrCode:        result.qrCode,
      cleartaxRef:   result.cleartaxRef,
      subtotal, cgst, sgst, total,
      guestName:     entry.guestName,
      guestPhone:    entry.guestPhone,
      venueGstin:    venue.gstin,
    },
  });
}

async function capturePaymentByOrder(params: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  expectedType: PaymentType;
  razorpaySignature?: string;
  skipSignatureVerification?: boolean;
}) {
  const payment = await prisma.payment.findFirst({
    where: { razorpayOrderId: params.razorpayOrderId },
    include: { order: { include: { queueEntry: true } } },
  });
  if (!payment) throw new AppError('Payment record not found', 404);
  if (payment.type !== params.expectedType) {
    throw new AppError('Payment type mismatch for capture path', 400, 'PAYMENT_TYPE_MISMATCH');
  }

  if (payment.status === PaymentStatus.CAPTURED) {
    return payment;
  }

  if (!params.skipSignatureVerification) {
    const valid = verifyPaymentSignature({
      orderId: params.razorpayOrderId,
      paymentId: params.razorpayPaymentId,
      signature: params.razorpaySignature ?? '',
    });
    if (!valid) {
      const remotePayment = await fetchRazorpayPayment(params.razorpayPaymentId).catch(() => null);
      const remotelyVerified = Boolean(
        remotePayment &&
        remotePayment.id === params.razorpayPaymentId &&
        remotePayment.order_id === params.razorpayOrderId &&
        ['authorized', 'captured'].includes(String(remotePayment.status).toLowerCase())
      );

      if (!remotelyVerified) {
        throw new AppError('Payment signature invalid', 400, 'SIGNATURE_INVALID');
      }
    }
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: PaymentStatus.CAPTURED,
      razorpayPaymentId: params.razorpayPaymentId,
      ...(params.razorpaySignature ? { razorpaySignature: params.razorpaySignature } : {}),
      capturedAt: new Date(),
    },
  });

  if (payment.type === PaymentType.DEPOSIT) {
    await prisma.queueEntry.update({
      where: { id: payment.order.queueEntryId },
      data: {
        depositPaid: { increment: payment.amount },
        depositTxnRef: payment.txnRef,
        preOrderTotal: payment.order.totalIncGst,
      },
    });

    await Notify.orderConfirmed(
      payment.venueId,
      payment.order.queueEntryId,
      payment.order.queueEntry.guestPhone,
      payment.order.queueEntry.guestName,
      payment.txnRef,
      payment.amount
    );
  }

  if (payment.type === PaymentType.FINAL) {
    await completeQueueEntry(payment.order.queueEntryId);
    await issueFinalInvoice(payment.order.queueEntryId, payment.venueId);
  }

  return {
    ...payment,
    status: PaymentStatus.CAPTURED,
    razorpayPaymentId: params.razorpayPaymentId,
    razorpaySignature: params.razorpaySignature ?? payment.razorpaySignature,
  };
}

// ── Bill summary helper ───────────────────────────────────────────

async function getBillSummary(queueEntryId: string) {
  const entry = await prisma.queueEntry.findUnique({
    where: { id: queueEntryId },
    include: { orders: { include: { items: true }, where: { status: { notIn: ['CANCELLED'] } } } },
  });
  if (!entry) throw new AppError('Queue entry not found', 404);

  const billableOrders = selectBillableOrders(entry.orders);
  const allItems   = billableOrders.flatMap(o => o.items);
  const totalIncGst = allItems.reduce((s, i) => s + i.totalIncGst, 0);
  return { totalIncGst, depositPaid: entry.depositPaid, balanceDue: Math.max(0, totalIncGst - entry.depositPaid) };
}
