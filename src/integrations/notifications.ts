import { env } from '../config/env';
import { logger } from '../config/logger';
import { prisma } from '../config/database';
import { NotificationType, NotificationChannel, NotificationStatus, Prisma } from '@prisma/client';

// ── Template builders ──────────────────────────────────────────────

function otpMessage(otp: string, venueName: string): string {
  return `Your Flock OTP for ${venueName} is *${otp}*. Valid for 5 minutes. Do not share.`;
}

function queueJoinedMessage(name: string, position: number, waitMin: number, venueName: string): string {
  return `Hi ${name}! You're #${position} in the queue at ${venueName}. Estimated wait: ~${waitMin} mins. We'll WhatsApp you when your table's ready.`;
}

function tableReadyMessage(name: string, tableLabel: string, venueName: string, windowMin: number): string {
  return `Great news ${name}! Your table (${tableLabel}) is ready at ${venueName}. Please arrive within ${windowMin} minutes or it may be reassigned.`;
}

function orderConfirmedMessage(name: string, txnRef: string, amount: number): string {
  return `Pre-order confirmed! ₹${(amount / 100).toFixed(2)} deposit received. Ref: ${txnRef}. Your food will be ready when you're seated.`;
}

// ── Gupshup WhatsApp sender ────────────────────────────────────────

async function sendWhatsApp(to: string, message: string): Promise<string> {
  if (env.USE_MOCK_NOTIFICATIONS) {
    logger.debug(`[MOCK WhatsApp → ${to}]: ${message}`);
    return `mock_wa_${Date.now()}`;
  }

  const url = 'https://api.gupshup.io/sm/api/v1/msg';
  const body = new URLSearchParams({
    channel:    'whatsapp',
    source:     env.GUPSHUP_SOURCE_NUMBER,
    destination: to,
    message:    JSON.stringify({ type: 'text', text: message }),
    'src.name': env.GUPSHUP_APP_NAME,
  });

  const res = await fetch(url, {
    method:  'POST',
    headers: { apikey: env.GUPSHUP_API_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });

  const data = await res.json() as { messageId?: string; status?: string };
  if (!res.ok) throw new Error(`Gupshup error: ${JSON.stringify(data)}`);
  return data.messageId ?? 'unknown';
}

// ── MSG91 SMS sender ───────────────────────────────────────────────

async function sendSms(to: string, message: string): Promise<string> {
  if (env.USE_MOCK_NOTIFICATIONS) {
    logger.debug(`[MOCK SMS → ${to}]: ${message}`);
    return `mock_sms_${Date.now()}`;
  }

  const url = `https://api.msg91.com/api/v2/sendsms`;
  const res = await fetch(url, {
    method:  'POST',
    headers: {
      authkey: env.MSG91_AUTH_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender:    env.MSG91_SENDER_ID,
      route:     '4',
      country:   '91',
      sms: [{ message, to: [to] }],
    }),
  });

  const data = await res.json() as { request_id?: string; type?: string };
  if (!res.ok) throw new Error(`MSG91 error: ${JSON.stringify(data)}`);
  return data.request_id ?? 'unknown';
}

// ── Unified send + logging ─────────────────────────────────────────

export interface SendNotificationParams {
  venueId:      string;
  queueEntryId?: string;
  type:         NotificationType;
  to:           string;
  message:      string;
  channel?:     NotificationChannel;
  payload?:     Record<string, unknown>;
}

export async function sendNotification(params: SendNotificationParams): Promise<void> {
  const channel = params.channel ?? NotificationChannel.WHATSAPP;
  const log = await prisma.notification.create({
    data: {
      venueId:      params.venueId,
      queueEntryId: params.queueEntryId,
      type:         params.type,
      channel,
      to:           params.to,
      payload:      params.payload as Prisma.InputJsonValue | undefined,
      status:       NotificationStatus.PENDING,
    },
  });

  try {
    let externalRef: string;
    if (channel === NotificationChannel.WHATSAPP) {
      externalRef = await sendWhatsApp(params.to, params.message);
    } else {
      externalRef = await sendSms(params.to, params.message);
    }

    await prisma.notification.update({
      where: { id: log.id },
      data:  { status: NotificationStatus.SENT, externalRef, sentAt: new Date() },
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error('Notification send failed', { error, to: params.to, type: params.type });
    await prisma.notification.update({
      where: { id: log.id },
      data:  { status: NotificationStatus.FAILED, error },
    });
    // Try SMS fallback if WhatsApp fails
    if (channel === NotificationChannel.WHATSAPP) {
      await sendNotification({ ...params, channel: NotificationChannel.SMS });
    }
  }
}

// ── Convenience wrappers ───────────────────────────────────────────

export const Notify = {
  otp: (venueId: string, phone: string, otp: string, venueName: string) =>
    sendNotification({ venueId, type: NotificationType.OTP, to: phone, message: otpMessage(otp, venueName) }),

  queueJoined: (venueId: string, entryId: string, phone: string, name: string, position: number, waitMin: number, venueName: string) =>
    sendNotification({ venueId, queueEntryId: entryId, type: NotificationType.QUEUE_JOINED, to: phone,
      message: queueJoinedMessage(name, position, waitMin, venueName) }),

  tableReady: (venueId: string, entryId: string, phone: string, name: string, tableLabel: string, venueName: string, windowMin: number) =>
    sendNotification({ venueId, queueEntryId: entryId, type: NotificationType.TABLE_READY, to: phone,
      message: tableReadyMessage(name, tableLabel, venueName, windowMin) }),

  orderConfirmed: (venueId: string, entryId: string, phone: string, name: string, txnRef: string, amount: number) =>
    sendNotification({ venueId, queueEntryId: entryId, type: NotificationType.ORDER_CONFIRMED, to: phone,
      message: orderConfirmedMessage(name, txnRef, amount) }),
};
