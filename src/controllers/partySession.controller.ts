import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthenticatedRequest } from '../types';
import * as PartySessionService from '../services/partySession.service';
import { ok, created } from '../utils/response';

const JoinSessionSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
});

const UpdateBucketSchema = z.object({
  items: z.array(z.object({
    menuItemId: z.string().min(1),
    quantity: z.number().int().min(0).max(99),
  })).max(100),
});

export async function joinPartySession(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const payload = JoinSessionSchema.parse(req.body ?? {});
    const result = await PartySessionService.joinPartySessionByToken({
      joinToken: req.params.joinToken,
      displayName: payload.displayName,
    });
    created(res, result);
  } catch (error) {
    next(error);
  }
}

export async function getPartySessionSummary(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await PartySessionService.getPartySessionSummary(req.params.sessionId, req.guest!);
    ok(res, data);
  } catch (error) {
    next(error);
  }
}

export async function getPartyParticipants(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await PartySessionService.getPartyParticipants(req.params.sessionId, req.guest!);
    ok(res, data);
  } catch (error) {
    next(error);
  }
}

export async function getPartyBucket(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await PartySessionService.getPartyBucket(req.params.sessionId, req.guest!);
    ok(res, data);
  } catch (error) {
    next(error);
  }
}

export async function updatePartyBucket(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const payload = UpdateBucketSchema.parse(req.body);
    const data = await PartySessionService.updatePartyBucket(req.params.sessionId, req.guest!, payload.items);
    ok(res, data);
  } catch (error) {
    next(error);
  }
}
