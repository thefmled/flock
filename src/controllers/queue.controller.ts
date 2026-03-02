import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthenticatedRequest } from '../types';
import * as QueueService from '../services/queue.service';
import { ok, created } from '../utils/response';

const JoinSchema = z.object({
  venueId:    z.string().min(1),
  guestName:  z.string().min(1).max(80),
  guestPhone: z.string().regex(/^[6-9]\d{9}$/),
  partySize:  z.number().int().min(1).max(20),
});

const SeatSchema = z.object({
  otp:     z.string().length(6),
  tableId: z.string().min(1),
});

const SessionSchema = z.object({
  otp: z.string().length(6),
});

export async function joinQueue(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await QueueService.joinQueue(JoinSchema.parse(req.body));
    created(res, result);
  } catch (e) { next(e); }
}

export async function getVenueQueue(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const entries = await QueueService.getVenueQueue(req.venue!.id);
    ok(res, entries, { count: entries.length });
  } catch (e) { next(e); }
}

export async function getQueueEntry(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.guest || req.guest.queueEntryId !== req.params.entryId) {
      res.status(403).json({ success: false, error: 'Guest session does not match this queue entry' });
      return;
    }
    const entry = await QueueService.getQueueEntry(req.params.entryId);
    ok(res, entry);
  } catch (e) { next(e); }
}

export async function reissueGuestSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { otp } = SessionSchema.parse(req.body);
    const session = await QueueService.reissueGuestSession(req.params.entryId, otp);
    ok(res, session);
  } catch (e) { next(e); }
}

export async function seatGuest(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { otp, tableId } = SeatSchema.parse(req.body);
    const result = await QueueService.seatGuest({ venueId: req.venue!.id, otp, tableId });
    ok(res, result);
  } catch (e) { next(e); }
}

export async function cancelEntry(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await QueueService.cancelQueueEntry(req.params.entryId, req.venue!.id);
    ok(res, result);
  } catch (e) { next(e); }
}
