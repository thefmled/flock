import { prisma } from '../config/database';
import { redis, RedisKeys, PubSubChannels, isRedisReady } from '../config/redis';
import { generateSeatingOtp } from '../utils/otp';
import { Notify } from '../integrations/notifications';
import { AppError } from '../middleware/errorHandler';
import { PaymentStatus, PaymentType, QueueEntryStatus, TableStatus } from '@prisma/client';
import { QueuePositionInfo } from '../types';
import { logger } from '../config/logger';
import { syncPendingPreOrderForSeating } from './order.service';
import { signGuestToken } from '../utils/jwt';
import { initiateRefund } from '../integrations/razorpay';
import { ensurePartySessionForQueueEntry } from './partySession.service';

const AVG_TURN_MINUTES = 55; // used for wait time estimation

// ── Join queue ────────────────────────────────────────────────────

export async function joinQueue(params: {
  venueId:    string;
  guestName:  string;
  guestPhone: string;
  partySize:  number;
}): Promise<{ id: string; otp: string; position: number; estimatedWaitMin: number; guestToken: string }> {
  const venue = await prisma.venue.findUnique({ where: { id: params.venueId } });
  if (!venue) throw new AppError('Venue not found', 404);
  if (!venue.isQueueOpen) throw new AppError('Queue is currently closed', 400, 'QUEUE_CLOSED');

  // Count active entries
  const activeCount = await prisma.queueEntry.count({
    where: { venueId: params.venueId, status: { in: ['WAITING', 'NOTIFIED'] } },
  });
  if (activeCount >= venue.maxQueueSize) throw new AppError('Queue is full', 400, 'QUEUE_FULL');

  // Prevent duplicate phone in same venue queue
  const existing = await prisma.queueEntry.findFirst({
    where: { venueId: params.venueId, guestPhone: params.guestPhone, status: { in: ['WAITING', 'NOTIFIED'] } },
  });
  if (existing) throw new AppError('This phone is already in the queue', 400, 'ALREADY_IN_QUEUE');

  const position = activeCount + 1;
  const estimatedWaitMin = estimateWait(params.venueId, position);
  const otp = generateSeatingOtp();

  const entry = await prisma.queueEntry.create({
    data: {
      venueId:         params.venueId,
      guestName:       params.guestName,
      guestPhone:      params.guestPhone,
      partySize:       params.partySize,
      position,
      otp,
      estimatedWaitMin,
    },
  });

  const { session, hostParticipant } = await ensurePartySessionForQueueEntry({
    queueEntryId: entry.id,
    venueId: entry.venueId,
    guestName: entry.guestName,
    guestPhone: entry.guestPhone,
  });

  // Cache in Redis for low-latency reads
  await safeRedisExec(() =>
    redis.set(
      RedisKeys.queueEntry(entry.id),
      JSON.stringify({ id: entry.id, position, status: 'WAITING', partySize: params.partySize }),
      'EX', 3600 * 12
    )
  );

  // Publish queue update
  await safeRedisExec(() =>
    redis.publish(PubSubChannels.queueUpdate(params.venueId), JSON.stringify({ type: 'ENTRY_ADDED', position }))
  );

  await Notify.queueJoined(params.venueId, entry.id, params.guestPhone, params.guestName, position, estimatedWaitMin, venue.name);

  return {
    id: entry.id,
    otp,
    position,
    estimatedWaitMin,
    guestToken: issueGuestSessionToken({
      queueEntryId: entry.id,
      venueId: entry.venueId,
      guestPhone: entry.guestPhone,
      partySessionId: session.id,
      participantId: hostParticipant.id,
    }),
  };
}

// ── Get live queue ─────────────────────────────────────────────────

export async function getVenueQueue(venueId: string) {
  const entries = await prisma.queueEntry.findMany({
    where:   { venueId, status: { in: ['WAITING', 'NOTIFIED', 'SEATED'] } },
    orderBy: { position: 'asc' },
    include: {
      table: {
        select: {
          id: true,
          label: true,
          section: true,
        },
      },
      orders: {
        where: { status: { notIn: ['CANCELLED'] } },
        select: {
          id: true,
          type: true,
          status: true,
          totalIncGst: true,
          items: {
            select: {
              id: true,
              menuItemId: true,
              name: true,
              quantity: true,
            },
          },
        },
      },
    },
  });
  return entries;
}

// ── Get single entry ───────────────────────────────────────────────

export async function getQueueEntry(entryId: string) {
  const entry = await prisma.queueEntry.findUnique({
    where: { id: entryId },
    include: {
      orders: {
        where: { status: { notIn: ['CANCELLED'] } },
        include: { items: true },
      },
      table: { select: { label: true, section: true } },
      partySession: {
        select: {
          id: true,
          joinToken: true,
          status: true,
        },
      },
    },
  });
  if (!entry) throw new AppError('Queue entry not found', 404);

  const { otp: _otp, ...safeEntry } = entry;
  return safeEntry;
}

export async function reissueGuestSession(entryId: string, otp: string) {
  const entry = await prisma.queueEntry.findUnique({
    where: { id: entryId },
    select: {
      id: true,
      venueId: true,
      guestPhone: true,
      otp: true,
      status: true,
    },
  });

  if (!entry || !['WAITING', 'NOTIFIED', 'SEATED'].includes(entry.status)) {
    throw new AppError('Queue entry not eligible for guest session recovery', 400, 'ENTRY_NOT_ACTIVE');
  }

  if (entry.otp !== otp) {
    throw new AppError('Incorrect OTP', 400, 'OTP_INCORRECT');
  }

  const { session, hostParticipant } = await ensurePartySessionForQueueEntry({
    queueEntryId: entry.id,
    venueId: entry.venueId,
    guestPhone: entry.guestPhone,
  });

  return {
    guestToken: issueGuestSessionToken({
      queueEntryId: entry.id,
      venueId: entry.venueId,
      guestPhone: entry.guestPhone,
      partySessionId: session.id,
      participantId: hostParticipant.id,
    }),
  };
}

// ── Seat guest (OTP verification) ────────────────────────────────

export async function seatGuest(params: {
  venueId: string;
  otp:     string;
  tableId: string;
}): Promise<{ entryId: string; guestName: string; preOrderSync: { attempted: boolean; status: string; posOrderId?: string } }> {
  const entry = await prisma.queueEntry.findFirst({
    where: { otp: params.otp, venueId: params.venueId, status: { in: ['WAITING', 'NOTIFIED'] } },
  });
  if (!entry) throw new AppError('Invalid OTP or guest not in queue', 400, 'OTP_INVALID');

  const table = await prisma.table.findFirst({ where: { id: params.tableId, venueId: params.venueId } });
  if (!table) throw new AppError('Table not found', 404);
  if (table.status !== TableStatus.FREE && table.status !== TableStatus.RESERVED) {
    throw new AppError('Table is not available', 400, 'TABLE_NOT_AVAILABLE');
  }

  await prisma.$transaction(async (tx) => {
    await tx.queueEntry.update({
      where: { id: entry.id },
      data:  {
        status: QueueEntryStatus.SEATED,
        tableId: params.tableId,
        seatedAt: new Date(),
        tableReadyDeadlineAt: null,
      },
    });
    await tx.table.update({
      where: { id: params.tableId },
      data:  { status: TableStatus.OCCUPIED, occupiedSince: new Date() },
    });
    await tx.tableEvent.create({
      data: { tableId: params.tableId, fromStatus: table.status, toStatus: TableStatus.OCCUPIED, triggeredBy: 'OTP_SEAT' },
    });
  });

  // Recompact positions for remaining waiting guests
  await recompactPositions(params.venueId);

  await safeRedisExec(() =>
    redis.publish(PubSubChannels.tableUpdate(params.venueId), JSON.stringify({ type: 'TABLE_OCCUPIED', tableId: params.tableId }))
  );
  await safeRedisExec(() =>
    redis.publish(PubSubChannels.queueUpdate(params.venueId), JSON.stringify({ type: 'ENTRY_SEATED', entryId: entry.id }))
  );

  let preOrderSync: { attempted: boolean; status: string; posOrderId?: string } = {
    attempted: false,
    status: 'no_preorder',
  };

  try {
    preOrderSync = await syncPendingPreOrderForSeating({
      venueId: params.venueId,
      queueEntryId: entry.id,
      tableId: table.label,
    });
  } catch (err) {
    logger.error('Pre-order sync after seating failed', { entryId: entry.id, err: String(err) });
    preOrderSync = { attempted: true, status: 'manual_fallback' };
  }

  return { entryId: entry.id, guestName: entry.guestName, preOrderSync };
}

// ── Cancel entry ──────────────────────────────────────────────────

export async function cancelQueueEntry(entryId: string, venueId: string): Promise<{
  queueCancelled: true;
  refundStatus: 'refunded' | 'failed' | 'not_needed';
  refundedPaymentId?: string;
  refundId?: string;
  refundFailureReason?: string;
}> {
  const entry = await prisma.queueEntry.findFirst({
    where: { id: entryId, venueId, status: { in: ['WAITING', 'NOTIFIED'] } },
  });
  if (!entry) throw new AppError('Queue entry not found or already completed', 404);

  const [capturedDeposit, capturedFinal] = await Promise.all([
    prisma.payment.findFirst({
      where: {
        venueId,
        type: PaymentType.DEPOSIT,
        status: PaymentStatus.CAPTURED,
        order: {
          queueEntryId: entryId,
          status: { not: 'CANCELLED' },
        },
      },
      orderBy: { capturedAt: 'desc' },
    }),
    prisma.payment.findFirst({
      where: {
        venueId,
        type: PaymentType.FINAL,
        status: PaymentStatus.CAPTURED,
        order: {
          queueEntryId: entryId,
        },
      },
    }),
  ]);

  let refundStatus: 'refunded' | 'failed' | 'not_needed' = 'not_needed';
  let refundedPaymentId: string | undefined;
  let refundId: string | undefined;
  let refundFailureReason: string | undefined;

  if (capturedDeposit && !capturedFinal) {
    try {
      if (!capturedDeposit.razorpayPaymentId) {
        throw new AppError('No Razorpay payment ID on captured deposit', 400);
      }

      const refund = await initiateRefund({
        paymentId: capturedDeposit.razorpayPaymentId,
        amount: capturedDeposit.amount,
        notes: { reason: 'QUEUE_CANCELLED' },
      });

      await prisma.payment.update({
        where: { id: capturedDeposit.id },
        data: {
          status: PaymentStatus.REFUNDED,
          refundedAt: new Date(),
          refundAmount: capturedDeposit.amount,
        },
      });

      refundStatus = 'refunded';
      refundedPaymentId = capturedDeposit.id;
      refundId = refund.id;
    } catch (error) {
      refundStatus = 'failed';
      refundFailureReason = error instanceof Error ? error.message : 'Refund failed';
      logger.error('Auto-refund failed during queue cancellation', {
        queueEntryId: entryId,
        paymentId: capturedDeposit.id,
        error: refundFailureReason,
      });
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.queueEntry.update({
      where: { id: entryId },
      data:  {
        status: QueueEntryStatus.CANCELLED,
        tableId: null,
        tableReadyDeadlineAt: null,
      },
    });

    if (entry.tableId) {
      const table = await tx.table.findUnique({ where: { id: entry.tableId } });
      if (table?.status === TableStatus.RESERVED) {
        await tx.table.update({ where: { id: table.id }, data: { status: TableStatus.FREE } });
        await tx.tableEvent.create({
          data: { tableId: table.id, fromStatus: TableStatus.RESERVED, toStatus: TableStatus.FREE, triggeredBy: 'QUEUE_CANCELLED' },
        });
      }
    }
  });

  await recompactPositions(venueId);
  await safeRedisExec(() => redis.del(RedisKeys.queueEntry(entryId)));
  await safeRedisExec(() =>
    redis.publish(PubSubChannels.queueUpdate(venueId), JSON.stringify({ type: 'ENTRY_CANCELLED', entryId }))
  );

  return {
    queueCancelled: true,
    refundStatus,
    refundedPaymentId,
    refundId,
    refundFailureReason,
  };
}

// ── Complete (checkout) ───────────────────────────────────────────

export async function completeQueueEntry(entryId: string): Promise<void> {
  const entry = await prisma.queueEntry.findUnique({ where: { id: entryId } });
  if (!entry) throw new AppError('Queue entry not found', 404);

  await prisma.$transaction(async (tx) => {
    await tx.queueEntry.update({
      where: { id: entryId },
      data:  {
        status: QueueEntryStatus.COMPLETED,
        completedAt: new Date(),
        tableReadyDeadlineAt: null,
      },
    });
    if (entry.tableId) {
      await tx.table.update({
        where: { id: entry.tableId },
        data:  { status: TableStatus.CLEARING, occupiedSince: null },
      });
      await tx.tableEvent.create({
        data: { tableId: entry.tableId, fromStatus: TableStatus.OCCUPIED, toStatus: TableStatus.CLEARING, triggeredBy: 'PAYMENT' },
      });
    }
  });

  if (entry.tableId) {
    await safeRedisExec(() =>
      redis.publish(PubSubChannels.tableUpdate(entry.venueId), JSON.stringify({ type: 'TABLE_CLEARING', tableId: entry.tableId }))
    );
  }
}

// ── Internal helpers ──────────────────────────────────────────────

async function recompactPositions(venueId: string): Promise<void> {
  const waiting = await prisma.queueEntry.findMany({
    where:   { venueId, status: { in: ['WAITING', 'NOTIFIED'] } },
    orderBy: { joinedAt: 'asc' },
  });

  await Promise.all(
    waiting.map((entry, idx) =>
      prisma.queueEntry.update({ where: { id: entry.id }, data: { position: idx + 1, estimatedWaitMin: estimateWait(venueId, idx + 1) } })
    )
  );
}

function estimateWait(_venueId: string, position: number): number {
  // TODO: replace with real table-turnover data per venue from TMS
  return Math.ceil(position * AVG_TURN_MINUTES * 0.7);
}

async function safeRedisExec(operation: () => Promise<unknown>): Promise<void> {
  if (!isRedisReady()) return;

  try {
    await operation();
  } catch (err) {
    logger.warn('Redis operation skipped after failure', { err: String(err) });
  }
}

function issueGuestSessionToken(params: {
  queueEntryId: string;
  venueId: string;
  guestPhone: string;
  partySessionId?: string;
  participantId?: string;
}): string {
  return signGuestToken({
    kind: 'guest',
    queueEntryId: params.queueEntryId,
    venueId: params.venueId,
    guestPhone: params.guestPhone,
    partySessionId: params.partySessionId,
    participantId: params.participantId,
  });
}
