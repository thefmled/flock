/**
 * TMS Poller — runs every TMS_POLL_INTERVAL_MS
 *
 * For each venue with a TMS integration, fetches live table states
 * and syncs them to Flock's DB. When a table becomes FREE, fires
 * tryAdvanceQueue to notify the next waiting guest.
 *
 * For MANUAL venues, this still runs but only processes tables that
 * staff have marked as CLEARING -> FREE via the dashboard.
 */
import { prisma } from '../config/database';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { sweepExpiredTableReadyEntries, tryAdvanceQueue, updateTableStatus } from '../services/table.service';
import { TableStatus, TmsProvider } from '@prisma/client';

interface TmsTableState {
  externalId: string;
  status:     'free' | 'occupied' | 'clearing';
}

// ── Adapters per TMS provider ─────────────────────────────────────

async function fetchPosistTables(venueId: string, apiKey: string, externalVenueId: string): Promise<TmsTableState[]> {
  if (env.USE_MOCK_POS) {
    // Simulate random table turnover for dev/demo
    return simulateTableStates(venueId);
  }
  const res = await fetch(`https://api.posist.com/api/v1/venues/${externalVenueId}/tables`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const data = await res.json() as { tables: Array<{ id: string; state: string }> };
  return data.tables.map(t => ({ externalId: t.id, status: mapPosistStatus(t.state) }));
}

async function fetchPetpoojaaTables(_venueId: string, _apiKey: string, _externalId: string): Promise<TmsTableState[]> {
  if (env.USE_MOCK_POS) return simulateTableStates(_venueId);
  // Petpooja integration — implement when partnership is confirmed
  logger.warn('Petpooja TMS integration not yet implemented');
  return [];
}

function mapPosistStatus(s: string): 'free' | 'occupied' | 'clearing' {
  const map: Record<string, 'free' | 'occupied' | 'clearing'> = {
    available: 'free', occupied: 'occupied', running: 'occupied',
    requested: 'clearing', closed: 'clearing', dirty: 'clearing',
  };
  return map[s.toLowerCase()] ?? 'occupied';
}

async function simulateTableStates(venueId: string): Promise<TmsTableState[]> {
  const tables = await prisma.table.findMany({ where: { venueId } });
  return tables.map(t => {
    // Randomly transition occupied→clearing→free for simulation
    let status: 'free' | 'occupied' | 'clearing' = 'occupied';
    if (t.status === 'OCCUPIED' && t.occupiedSince) {
      const age = Date.now() - t.occupiedSince.getTime();
      if (age > 45 * 60 * 1000) status = 'clearing';  // 45+ mins: clearing
    } else if (t.status === 'CLEARING') {
      status = Math.random() > 0.7 ? 'free' : 'clearing'; // 30% chance of going free each poll
    } else if (t.status === 'FREE') {
      status = 'free';
    }
    return { externalId: t.tmsTableId ?? t.id, status };
  });
}

// ── Main poll loop ────────────────────────────────────────────────

async function pollVenue(venue: {
  id: string; tmsProvider: TmsProvider; tmsApiKey: string | null;
  tmsVenueId: string | null; isQueueOpen: boolean;
}): Promise<void> {
  if (!venue.isQueueOpen) return;

  let externalStates: TmsTableState[] = [];

  try {
    switch (venue.tmsProvider) {
      case TmsProvider.POSIST:
        externalStates = await fetchPosistTables(venue.id, venue.tmsApiKey ?? '', venue.tmsVenueId ?? '');
        break;
      case TmsProvider.PETPOOJA:
        externalStates = await fetchPetpoojaaTables(venue.id, venue.tmsApiKey ?? '', venue.tmsVenueId ?? '');
        break;
      case TmsProvider.MANUAL:
        // Manual venues process CLEARING → FREE transitions
        await processManualClearingTables(venue.id);
        return;
      default:
        return;
    }
  } catch (err) {
    logger.error('TMS poll fetch failed', { venueId: venue.id, err: String(err) });
    return;
  }

  // Build a map of our internal tables by tmsTableId
  const internalTables = await prisma.table.findMany({ where: { venueId: venue.id } });
  const byExternalId   = new Map(internalTables.filter(t => t.tmsTableId).map(t => [t.tmsTableId, t]));

  for (const ext of externalStates) {
    const internal = byExternalId.get(ext.externalId);
    if (!internal) continue;

    const targetStatus: TableStatus =
      ext.status === 'free' ? TableStatus.FREE :
      ext.status === 'clearing' ? TableStatus.CLEARING :
      TableStatus.OCCUPIED;

    if (internal.status === targetStatus) continue;

    // Don't override RESERVED (table assigned to notified guest)
    if (internal.status === TableStatus.RESERVED) continue;

    await updateTableStatus({ tableId: internal.id, venueId: venue.id, status: targetStatus, triggeredBy: 'TMS' });
  }
}

async function processManualClearingTables(venueId: string): Promise<void> {
  // For manual venues: staff marks tables as CLEARING; after 10 minutes auto-transition to FREE
  const clearingTables = await prisma.table.findMany({
    where: { venueId, status: TableStatus.CLEARING },
  });

  for (const table of clearingTables) {
    const lastEvent = await prisma.tableEvent.findFirst({
      where:   { tableId: table.id, toStatus: TableStatus.CLEARING },
      orderBy: { createdAt: 'desc' },
    });
    if (!lastEvent) continue;

    const ageMin = (Date.now() - lastEvent.createdAt.getTime()) / 60000;
    if (ageMin >= 5) {
      await updateTableStatus({ tableId: table.id, venueId, status: TableStatus.FREE, triggeredBy: 'AUTO_CLEARING' });
    }
  }
}

// ── Worker entrypoint ─────────────────────────────────────────────

export function startTmsPoller(): NodeJS.Timeout {
  logger.info(`TMS poller starting (interval: ${env.TMS_POLL_INTERVAL_MS}ms)`);

  return setInterval(async () => {
    try {
      await sweepExpiredTableReadyEntries();

      const venues = await prisma.venue.findMany({
        where:  { isQueueOpen: true },
        select: { id: true, tmsProvider: true, tmsApiKey: true, tmsVenueId: true, isQueueOpen: true },
      });

      await Promise.allSettled(venues.map(pollVenue));
    } catch (err) {
      logger.error('TMS poller tick failed', { err: String(err) });
    }
  }, env.TMS_POLL_INTERVAL_MS);
}
