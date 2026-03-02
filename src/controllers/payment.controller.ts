import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthenticatedRequest } from '../types';
import * as PaymentService from '../services/payment.service';
import { verifyWebhookSignature } from '../integrations/razorpay';
import { ok } from '../utils/response';
import { AppError } from '../middleware/errorHandler';

const InitiateDepositSchema = z.object({
  queueEntryId: z.string().min(1),
  orderId:      z.string().min(1),
  venueId:      z.string().min(1),
});

const CaptureSchema = z.object({
  razorpayOrderId:   z.string(),
  razorpayPaymentId: z.string(),
  razorpaySignature: z.string(),
});

export async function initiateDeposit(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = InitiateDepositSchema.parse(req.body);
    if (!req.guest || req.guest.queueEntryId !== data.queueEntryId || req.guest.venueId !== data.venueId) {
      res.status(403).json({ success: false, error: 'Guest session does not match this payment target' });
      return;
    }
    const result = await PaymentService.initiateDeposit(data);
    ok(res, result);
  } catch (e) { next(e); }
}

export async function captureDeposit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await PaymentService.captureDeposit(CaptureSchema.parse(req.body));
    ok(res, result);
  } catch (e) { next(e); }
}

export async function initiateFinalPayment(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { queueEntryId, venueId } = z.object({ queueEntryId: z.string().min(1), venueId: z.string().min(1) }).parse(req.body);
    if (!req.guest || req.guest.queueEntryId !== queueEntryId || req.guest.venueId !== venueId) {
      res.status(403).json({ success: false, error: 'Guest session does not match this payment target' });
      return;
    }
    const result = await PaymentService.initiateFinalPayment({ venueId, queueEntryId });
    ok(res, result);
  } catch (e) { next(e); }
}

export async function captureFinalPayment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await PaymentService.captureFinalPayment(CaptureSchema.parse(req.body));
    ok(res, result);
  } catch (e) { next(e); }
}

export async function settleFinalOffline(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { queueEntryId } = z.object({ queueEntryId: z.string().min(1) }).parse(req.body);
    const result = await PaymentService.settleFinalOffline({
      venueId: req.venue!.id,
      queueEntryId,
      staffId: req.staff!.id,
    });
    ok(res, result);
  } catch (e) { next(e); }
}

export async function refundDeposit(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { paymentId, reason } = z.object({ paymentId: z.string().min(1), reason: z.string().optional() }).parse(req.body);
    const result = await PaymentService.refundDeposit({ paymentId, venueId: req.venue!.id, reason });
    ok(res, result);
  } catch (e) { next(e); }
}

/** Razorpay webhook endpoint */
export async function razorpayWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const signature = req.headers['x-razorpay-signature'] as string;
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body.toString('utf8')
      : JSON.stringify(req.body);

    if (!verifyWebhookSignature(rawBody, signature)) {
      throw new AppError('Webhook signature verification failed', 400, 'WEBHOOK_INVALID');
    }

    const parsed = Buffer.isBuffer(req.body)
      ? JSON.parse(rawBody)
      : req.body;
    const event = parsed.event as string;
    const payload = parsed.payload;

    switch (event) {
      case 'payment.captured': {
        const p = payload.payment?.entity;
        if (p) {
          await PaymentService.capturePaymentFromWebhook({
            razorpayOrderId: p.order_id,
            razorpayPaymentId: p.id,
          }).catch(() => {}); // may already be captured via client callback
        }
        break;
      }
      case 'order.paid': {
        const orderEntity = payload.order?.entity;
        const paymentEntity = payload.payment?.entity;
        if (orderEntity?.id && paymentEntity?.id) {
          await PaymentService.capturePaymentFromWebhook({
            razorpayOrderId: orderEntity.id,
            razorpayPaymentId: paymentEntity.id,
          }).catch(() => {}); // may already be captured via client callback
        }
        break;
      }
      case 'payment.failed': {
        const p = payload.payment?.entity;
        if (p?.order_id) {
          await import('../config/database').then(({ prisma }) =>
            prisma.payment.updateMany({
              where: { razorpayOrderId: p.order_id },
              data:  { status: 'FAILED', failureReason: p.error_description },
            })
          );
        }
        break;
      }
    }

    res.json({ status: 'ok' });
  } catch (e) { next(e); }
}
