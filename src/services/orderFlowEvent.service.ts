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
  return prisma.orderFlowEvent.findMany({
    where: { queueEntryId },
    orderBy: { createdAt: 'asc' },
  });
}
