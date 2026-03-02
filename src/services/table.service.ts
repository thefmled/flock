import { prisma } from '../config/database';
import { redis, PubSubChannels } from '../config/redis';
import { Notify } from '../integrations/notifications';
import { AppError } from '../middleware/errorHandler';
import { TableStatus, QueueEntryStatus } from '@prisma/client';
import { env } from '../config/env';
import { logger } from '../config/logger';

// ── Get tables for venue ──────────────────────────────────────────

export async function getVenueTables(venueId: string) {
  return prisma.table.findMany({
    where: { venueId },
    orderBy: [{ section: 'asc' }, { label: 'asc' }],
    include: {
      _count: { select: { queueEntries: { where: { status: 'SEATED' } } } },
    },
  });
}

export async function getRecentVenueTableEvents(venueId: string) {
  const events = await prisma.tableEvent.findMany({
    where: { table: { venueId } },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: {
      table: {
        select: { id: true, label: true },
      },
    },
  });

  return events.map((event) => ({
    id: event.id,
    tableId: event.tableId,
    tableLabel: event.table.label,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    triggeredBy: event.triggeredBy,
    note: event.note,
    createdAt: event.createdAt,
  }));
}

// ── Update table status (manual floor management) ─────────────────

export async function updateTableStatus(params: {
  tableId:    string;
  venueId:    string;
  status:     TableStatus;
  triggeredBy?: string;
}) {
  const table = await prisma.table.findFirst({ where: { id: params.tableId, venueId: params.venueId } });
  if (!table) throw new AppError('Table not found', 404);

  const oldStatus = table.status;

  await prisma.$transaction(async (tx) => {
    await tx.table.update({
      where: { id: params.tableId },
      data: {
        status: params.status,
        occupiedSince:   params.status === TableStatus.OCCUPIED ? new Date() : (params.status === TableStatus.FREE ? null : table.occupiedSince),
        estimatedFreeAt: null,
      },
    });
    await tx.tableEvent.create({
      data: { tableId: params.tableId, fromStatus: oldStatus, toStatus: params.status, triggeredBy: params.triggeredBy ?? 'STAFF' },
    });
  });

  await redis.publish(PubSubChannels.tableUpdate(params.venueId), JSON.stringify({
    type: 'TABLE_STATUS_CHANGED', tableId: params.tableId, from: oldStatus, to: params.status,
  }));

  // If table just became free, try to advance queue
  if (params.status === TableStatus.FREE) {
    await tryAdvanceQueue(params.venueId, params.tableId);
  }
}

// ── Core auto-advance logic ───────────────────────────────────────

export async function tryAdvanceQueue(venueId: string, tableId: string): Promise<void> {
  const table = await prisma.table.findUnique({ where: { id: tableId } });
  if (!table || table.status !== TableStatus.FREE) return;
  const venue = await prisma.venue.findUnique({ where: { id: venueId } });
  const tableReadyWindowMin = venue?.tableReadyWindowMin ?? env.TABLE_READY_WINDOW_MINUTES;

  // Find the first waiting group that fits this table
  const nextEntry = await prisma.queueEntry.findFirst({
    where:   { venueId, status: QueueEntryStatus.WAITING, partySize: { lte: table.capacity } },
    orderBy: { position: 'asc' },
  });

  if (!nextEntry) {
    logger.debug(`Table ${table.label} is free but no matching waiting guests`);
    return;
  }

  // Mark as RESERVED to prevent race conditions
  await prisma.$transaction(async (tx) => {
    await tx.table.update({ where: { id: tableId }, data: { status: TableStatus.RESERVED } });
    await tx.queueEntry.update({
      where: { id: nextEntry.id },
      data: {
        status: QueueEntryStatus.NOTIFIED,
        notifiedAt: new Date(),
        tableId,
        tableReadyDeadlineAt: new Date(Date.now() + tableReadyWindowMin * 60 * 1000),
        tableReadyExpiredAt: null,
      },
    });
    await tx.tableEvent.create({
      data: { tableId, fromStatus: TableStatus.FREE, toStatus: TableStatus.RESERVED, triggeredBy: 'AUTO_ADVANCE' },
    });
  });

  if (venue) {
    await Notify.tableReady(venueId, nextEntry.id, nextEntry.guestPhone, nextEntry.guestName, table.label, venue.name, venue.tableReadyWindowMin);
  }

  await redis.publish(PubSubChannels.queueUpdate(venueId), JSON.stringify({
    type: 'TABLE_ASSIGNED', entryId: nextEntry.id, tableId, tableLabel: table.label,
  }));

  logger.info(`Table ${table.label} assigned to ${nextEntry.guestName} (${nextEntry.id})`);
}

export async function sweepExpiredTableReadyEntries(): Promise<void> {
  const expiredEntries = await prisma.queueEntry.findMany({
    where: {
      status: QueueEntryStatus.NOTIFIED,
      tableReadyDeadlineAt: { lte: new Date() },
    },
    include: {
      table: true,
    },
    orderBy: { tableReadyDeadlineAt: 'asc' },
  });

  for (const entry of expiredEntries) {
    logger.warn(`Guest ${entry.id} did not arrive within window — marking as NO_SHOW`);

    const releasedTableId = entry.table && entry.table.status === TableStatus.RESERVED ? entry.table.id : null;

    await prisma.$transaction(async (tx) => {
      await tx.queueEntry.update({
        where: { id: entry.id },
        data: {
          status: QueueEntryStatus.NO_SHOW,
          tableId: null,
          tableReadyExpiredAt: new Date(),
          tableReadyDeadlineAt: null,
        },
      });

      if (releasedTableId && entry.table) {
        await tx.table.update({
          where: { id: releasedTableId },
          data: { status: TableStatus.FREE },
        });
        await tx.tableEvent.create({
          data: {
            tableId: releasedTableId,
            fromStatus: TableStatus.RESERVED,
            toStatus: TableStatus.FREE,
            triggeredBy: 'NO_SHOW_TIMEOUT',
          },
        });
      }
    });

    await recompactQueuePositions(entry.venueId);

    if (releasedTableId) {
      await tryAdvanceQueue(entry.venueId, releasedTableId);
    }
  }
}

async function recompactQueuePositions(venueId: string): Promise<void> {
  const activeEntries = await prisma.queueEntry.findMany({
    where: {
      venueId,
      status: { in: [QueueEntryStatus.WAITING, QueueEntryStatus.NOTIFIED] },
    },
    orderBy: { joinedAt: 'asc' },
  });

  await Promise.all(activeEntries.map((entry, index) =>
    prisma.queueEntry.update({
      where: { id: entry.id },
      data: {
        position: index + 1,
        estimatedWaitMin: Math.ceil((index + 1) * 55 * 0.7),
      },
    })
  ));
}
