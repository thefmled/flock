import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthenticatedRequest } from '../types';
import * as OrderService from '../services/order.service';
import { ok, created } from '../utils/response';

const ItemsSchema = z.array(z.object({
  menuItemId: z.string().min(1),
  quantity:   z.number().int().min(1).max(50),
  notes:      z.string().optional(),
})).min(1);

const OrderBodySchema = z.object({
  queueEntryId: z.string().min(1),
  items:        ItemsSchema,
  notes:        z.string().optional(),
});

export async function createPreOrder(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { queueEntryId, items, notes } = OrderBodySchema.parse(req.body);
    if (!req.guest || req.guest.queueEntryId !== queueEntryId) {
      res.status(403).json({ success: false, error: 'Guest session does not match this queue entry' });
      return;
    }
    const order = await OrderService.createPreOrder({ venueId: req.guest.venueId, queueEntryId, items, notes });
    created(res, order);
  } catch (e) { next(e); }
}

export async function createTableOrder(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { queueEntryId, items, notes } = OrderBodySchema.parse(req.body);
    const order = await OrderService.createTableOrder({ venueId: req.venue!.id, queueEntryId, items, notes });
    created(res, order);
  } catch (e) { next(e); }
}

export async function createGuestTableOrder(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { queueEntryId, items, notes } = OrderBodySchema.parse(req.body);
    if (!req.guest || req.guest.queueEntryId !== queueEntryId) {
      res.status(403).json({ success: false, error: 'Guest session does not match this queue entry' });
      return;
    }

    const order = await OrderService.createGuestTableOrder({
      venueId: req.guest.venueId,
      queueEntryId,
      items,
      notes,
    });
    created(res, order);
  } catch (e) { next(e); }
}

export async function getGuestBill(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.staff && (!req.guest || req.guest.queueEntryId !== req.params.queueEntryId)) {
      res.status(403).json({ success: false, error: 'Guest session does not match this queue entry' });
      return;
    }
    const bill = await OrderService.getGuestBill(req.params.queueEntryId);
    ok(res, bill);
  } catch (e) { next(e); }
}
