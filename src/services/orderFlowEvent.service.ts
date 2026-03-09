import { prisma } from '../config/database';
import { Prisma } from '@prisma/client';
import { logger } from '../config/logger';
import { OrderFlowEventType } from '@prisma/client';

export { OrderFlowEventType };

export interface FlowEventInput {
  queueEntryId: string;
  venueId:      string;
  type:         OrderFlowEventType;
  orderId?:     string;
  paymentId?:   string;
  snapshot?:    Record<string, unknown>;
}

export async function logFlowEvent(input: FlowEventInput): Promise<void> {
  try {
    await prisma.orderFlowEvent.create({
      data: {
        queueEntryId: input.queueEntryId,
        venueId:      input.venueId,
        type:         input.type,
        orderId:      input.orderId ?? null,
        paymentId:    input.paymentId ?? null,
        snapshot:     input.snapshot ? (input.snapshot as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });
  } catch (err) {
    logger.error('Failed to log order flow event (non-fatal)', {
      type: input.type,
      queueEntryId: input.queueEntryId,
      err: String(err),
    });
  }
}

export async function getFlowEvents(queueEntryId: string) {
  try {
    const events = await prisma.orderFlowEvent.findMany({
      where: { queueEntryId },
      orderBy: { createdAt: 'asc' },
    });

    if (events.length > 0) return events;
  } catch (err) {
    logger.warn('OrderFlowEvent table query failed, falling back to reconstruction', {
      queueEntryId,
      err: String(err),
    });
  }

  return reconstructTimeline(queueEntryId);
}

async function reconstructTimeline(queueEntryId: string) {
  const entry = await prisma.queueEntry.findUnique({
    where: { id: queueEntryId },
    include: {
      orders: { include: { items: true, payments: true }, orderBy: { createdAt: 'asc' } },
    },
  });
  if (!entry) return [];

  type ReconstructedEvent = {
    id: string;
    queueEntryId: string;
    venueId: string;
    type: string;
    orderId: string | null;
    paymentId: string | null;
    snapshot: Record<string, unknown>;
    createdAt: Date;
    reconstructed: true;
  };

  const timeline: ReconstructedEvent[] = [];
  const base = { queueEntryId, venueId: entry.venueId, reconstructed: true as const };

  timeline.push({
    ...base,
    id: `recon-join-${queueEntryId}`,
    type: 'QUEUE_JOINED',
    orderId: null,
    paymentId: null,
    snapshot: { position: entry.position, partySize: entry.partySize, guestName: entry.guestName, note: 'Reconstructed from existing data' },
    createdAt: entry.joinedAt,
  });

  if (entry.notifiedAt) {
    timeline.push({
      ...base,
      id: `recon-notified-${queueEntryId}`,
      type: 'TABLE_NOTIFIED',
      orderId: null,
      paymentId: null,
      snapshot: { tableId: entry.tableId, note: 'Reconstructed from existing data' },
      createdAt: entry.notifiedAt,
    });
  }

  for (const order of entry.orders) {
    const eventType = order.type === 'PRE_ORDER' ? 'PREORDER_CREATED' : 'TABLE_ORDER_CREATED';
    timeline.push({
      ...base,
      id: `recon-order-${order.id}`,
      type: eventType,
      orderId: order.id,
      paymentId: null,
      snapshot: { totalIncGst: order.totalIncGst, itemCount: order.items.length, note: 'Reconstructed from existing data' },
      createdAt: order.createdAt,
    });

    for (const payment of order.payments) {
      const payType = payment.type === 'DEPOSIT'
        ? (payment.status === 'CAPTURED' ? 'DEPOSIT_CAPTURED' : 'DEPOSIT_INITIATED')
        : (payment.status === 'CAPTURED' ? 'FINAL_PAYMENT_CAPTURED' : 'FINAL_PAYMENT_INITIATED');
      timeline.push({
        ...base,
        id: `recon-payment-${payment.id}`,
        type: payType,
        orderId: order.id,
        paymentId: payment.id,
        snapshot: { amount: payment.amount, status: payment.status, txnRef: payment.txnRef, note: 'Reconstructed from existing data' },
        createdAt: payment.capturedAt ?? payment.createdAt,
      });
    }
  }

  if (entry.seatedAt) {
    timeline.push({
      ...base,
      id: `recon-seated-${queueEntryId}`,
      type: 'GUEST_SEATED',
      orderId: null,
      paymentId: null,
      snapshot: { tableId: entry.tableId, note: 'Reconstructed from existing data' },
      createdAt: entry.seatedAt,
    });
  }

  if (entry.completedAt) {
    timeline.push({
      ...base,
      id: `recon-completed-${queueEntryId}`,
      type: 'ENTRY_COMPLETED',
      orderId: null,
      paymentId: null,
      snapshot: { note: 'Reconstructed from existing data' },
      createdAt: entry.completedAt,
    });
  }

  if (entry.status === 'CANCELLED') {
    timeline.push({
      ...base,
      id: `recon-cancelled-${queueEntryId}`,
      type: 'ENTRY_CANCELLED',
      orderId: null,
      paymentId: null,
      snapshot: { note: 'Reconstructed from existing data' },
      createdAt: entry.updatedAt,
    });
  }

  timeline.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return timeline;
}
