import Razorpay from 'razorpay';
import crypto from 'crypto';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { generateTxnRef } from '../utils/txnRef';

const razorpay = new Razorpay({
  key_id:     env.RAZORPAY_KEY_ID,
  key_secret: env.RAZORPAY_KEY_SECRET,
});

export interface CreateOrderParams {
  amount: number;       // paise
  currency?: string;
  receipt: string;      // txnRef
  notes?: Record<string, string>;
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
  status: string;
}

export interface InitiateRefundParams {
  paymentId: string;
  amount: number;       // paise
  notes?: Record<string, string>;
}

export interface RazorpayPayment {
  id: string;
  order_id: string;
  amount: number;
  status: string;
}

/** Create a Razorpay order for UPI payment */
export async function createRazorpayOrder(params: CreateOrderParams): Promise<RazorpayOrder> {
  if (env.USE_MOCK_PAYMENTS) {
    logger.debug('[MOCK] createRazorpayOrder', params);
    return {
      id:       `order_mock_${Date.now()}`,
      amount:   params.amount,
      currency: params.currency ?? 'INR',
      receipt:  params.receipt,
      status:   'created',
    };
  }

  const order = await razorpay.orders.create({
    amount:   params.amount,
    currency: params.currency ?? 'INR',
    receipt:  params.receipt,
    notes:    params.notes,
  });
  return order as unknown as RazorpayOrder;
}

/** Verify Razorpay webhook signature */
export function verifyWebhookSignature(body: string, signature: string): boolean {
  if (env.USE_MOCK_PAYMENTS) return true;
  const expected = crypto
    .createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET)
    .update(body)
    .digest('hex');
  return expected === signature;
}

/** Verify payment signature after client-side capture */
export function verifyPaymentSignature(params: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  if (env.USE_MOCK_PAYMENTS) return true;
  const message = `${params.orderId}|${params.paymentId}`;
  const expected = crypto
    .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
    .update(message)
    .digest('hex');
  return expected === params.signature;
}

/** Fetch payment details directly from Razorpay for server-side verification fallback */
export async function fetchRazorpayPayment(paymentId: string): Promise<RazorpayPayment> {
  if (env.USE_MOCK_PAYMENTS) {
    return {
      id: paymentId,
      order_id: '',
      amount: 0,
      status: 'captured',
    };
  }

  const payment = await (razorpay.payments as any).fetch(paymentId);
  return payment as RazorpayPayment;
}

/** Initiate refund */
export async function initiateRefund(params: InitiateRefundParams): Promise<{ id: string; amount: number; status: string }> {
  if (env.USE_MOCK_PAYMENTS) {
    logger.debug('[MOCK] initiateRefund', params);
    return { id: `rfnd_mock_${Date.now()}`, amount: params.amount, status: 'processed' };
  }

  const refund = await (razorpay.payments as any).refund(params.paymentId, {
    amount: params.amount,
    notes:  params.notes,
  });
  return refund;
}

/** Calculate fees: platform 2%, Razorpay ~2% */
export function calculateFees(amount: number): { platformFee: number; razorpayFee: number; netToVenue: number } {
  const platformFee  = Math.round(amount * 0.02);
  const razorpayFee  = Math.round(amount * 0.02);
  const netToVenue   = amount - platformFee - razorpayFee;
  return { platformFee, razorpayFee, netToVenue };
}
