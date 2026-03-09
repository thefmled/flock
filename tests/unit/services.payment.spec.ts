import { PaymentStatus, PaymentType } from '@prisma/client';
import { createPrismaMock } from '../helpers/mock-prisma';

const prismaMock = createPrismaMock();
const createRazorpayOrderMock = vi.fn();
const fetchRazorpayPaymentMock = vi.fn();
const initiateRefundMock = vi.fn();
const verifyPaymentSignatureMock = vi.fn(() => true);
const notifyMock = {
  orderConfirmed: vi.fn(),
};
const completeQueueEntryMock = vi.fn();
const generateGstInvoiceMock = vi.fn();
const logFlowEventMock = vi.fn();

vi.mock('../../src/config/database', () => ({
  prisma: prismaMock,
}));

vi.mock('../../src/integrations/razorpay', async () => {
  const actual = await vi.importActual<typeof import('../../src/integrations/razorpay')>('../../src/integrations/razorpay');
  return {
    ...actual,
    createRazorpayOrder: createRazorpayOrderMock,
    fetchRazorpayPayment: fetchRazorpayPaymentMock,
    initiateRefund: initiateRefundMock,
    verifyPaymentSignature: verifyPaymentSignatureMock,
  };
});

vi.mock('../../src/integrations/notifications', () => ({
  Notify: notifyMock,
}));

vi.mock('../../src/integrations/cleartax', () => ({
  generateGstInvoice: generateGstInvoiceMock,
}));

vi.mock('../../src/services/queue.service', () => ({
  completeQueueEntry: completeQueueEntryMock,
}));

vi.mock('../../src/services/orderFlowEvent.service', () => ({
  OrderFlowEventType: {
    DEPOSIT_INITIATED: 'DEPOSIT_INITIATED',
    DEPOSIT_CAPTURED: 'DEPOSIT_CAPTURED',
    FINAL_PAYMENT_INITIATED: 'FINAL_PAYMENT_INITIATED',
    FINAL_PAYMENT_CAPTURED: 'FINAL_PAYMENT_CAPTURED',
    DEPOSIT_REFUNDED: 'DEPOSIT_REFUNDED',
    OFFLINE_SETTLED: 'OFFLINE_SETTLED',
  },
  logFlowEvent: logFlowEventMock,
}));

describe('payment service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createRazorpayOrderMock.mockResolvedValue({
      id: 'order_rzp_1',
      amount: 24_338,
      currency: 'INR',
      receipt: 'FLK-TEST',
      status: 'created',
    });
  });

  it('reuses an existing pending deposit payment', async () => {
    const { initiateDeposit } = await import('../../src/services/payment.service');

    prismaMock.queueEntry.findFirst.mockResolvedValue({ id: 'entry_1', venueId: 'venue_1' });
    prismaMock.order.findFirst.mockResolvedValue({ id: 'order_1', totalIncGst: 32_450, venueId: 'venue_1', queueEntryId: 'entry_1' });
    prismaMock.venue.findUnique.mockResolvedValue({ id: 'venue_1', depositPercent: 75 });
    prismaMock.payment.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'payment_pending',
        txnRef: 'FLK-EXISTING',
        amount: 24_338,
        razorpayOrderId: 'order_rzp_existing',
        status: PaymentStatus.PENDING,
      });

    const result = await initiateDeposit({
      venueId: 'venue_1',
      queueEntryId: 'entry_1',
      orderId: 'order_1',
    });

    expect(result).toEqual(expect.objectContaining({
      paymentId: 'payment_pending',
      txnRef: 'FLK-EXISTING',
      amount: 24_338,
      balanceAtTable: 8_112,
    }));
    expect(prismaMock.payment.create).not.toHaveBeenCalled();
  });

  it('creates a new deposit payment using venue deposit math', async () => {
    const { initiateDeposit } = await import('../../src/services/payment.service');

    prismaMock.queueEntry.findFirst.mockResolvedValue({ id: 'entry_1', venueId: 'venue_1' });
    prismaMock.order.findFirst.mockResolvedValue({ id: 'order_1', totalIncGst: 32_450, venueId: 'venue_1', queueEntryId: 'entry_1' });
    prismaMock.venue.findUnique.mockResolvedValue({ id: 'venue_1', depositPercent: 75 });
    prismaMock.payment.findFirst.mockResolvedValue(null);
    prismaMock.payment.create.mockResolvedValue({
      id: 'payment_1',
      txnRef: 'FLK-ABC',
      amount: 24_338,
      razorpayOrderId: 'order_rzp_1',
    });

    const result = await initiateDeposit({
      venueId: 'venue_1',
      queueEntryId: 'entry_1',
      orderId: 'order_1',
    });

    expect(createRazorpayOrderMock).toHaveBeenCalledWith(expect.objectContaining({
      amount: 24_338,
      notes: expect.objectContaining({ type: 'DEPOSIT' }),
    }));
    expect(prismaMock.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        amount: 24_338,
        type: PaymentType.DEPOSIT,
        status: PaymentStatus.PENDING,
      }),
    }));
    expect(result.balanceAtTable).toBe(8_112);
  });

  it('captures deposit payments idempotently and updates queue deposit state', async () => {
    const { captureDeposit } = await import('../../src/services/payment.service');

    prismaMock.payment.findFirst.mockResolvedValue({
      id: 'payment_1',
      type: PaymentType.DEPOSIT,
      status: PaymentStatus.PENDING,
      amount: 24_338,
      venueId: 'venue_1',
      orderId: 'order_1',
      txnRef: 'FLK-TXN',
      order: {
        totalIncGst: 32_450,
        queueEntryId: 'entry_1',
        queueEntry: {
          depositPaid: 0,
          guestPhone: '9876543210',
          guestName: 'Neha',
        },
      },
    });
    prismaMock.payment.updateMany.mockResolvedValue({ count: 1 });

    const result = await captureDeposit({
      razorpayOrderId: 'order_rzp_1',
      razorpayPaymentId: 'pay_1',
      razorpaySignature: 'good',
    });

    expect(result).toEqual({
      txnRef: 'FLK-TXN',
      status: 'captured',
      amount: 24_338,
    });
    expect(prismaMock.queueEntry.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'entry_1' },
      data: expect.objectContaining({
        depositPaid: { increment: 24_338 },
        preOrderTotal: 32_450,
      }),
    }));
    expect(notifyMock.orderConfirmed).toHaveBeenCalled();
  });

  it('refunds captured deposits and records flow events', async () => {
    const { refundDeposit } = await import('../../src/services/payment.service');

    prismaMock.payment.findFirst.mockResolvedValue({
      id: 'payment_1',
      orderId: 'order_1',
      amount: 24_338,
      razorpayPaymentId: 'pay_1',
      order: { queueEntryId: 'entry_1' },
    });
    initiateRefundMock.mockResolvedValue({ id: 'refund_1', amount: 24_338, status: 'processed' });

    const result = await refundDeposit({
      paymentId: 'payment_1',
      venueId: 'venue_1',
      reason: 'guest_cancelled',
    });

    expect(prismaMock.payment.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'payment_1' },
      data: expect.objectContaining({ status: PaymentStatus.REFUNDED }),
    }));
    expect(result).toEqual({ refundId: 'refund_1', amount: 24_338, status: 'refunded' });
  });
});
