import { Prisma } from '@prisma/client';
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthenticatedRequest } from '../types';
import { prisma } from '../config/database';
import { ok, created } from '../utils/response';
import { AppError } from '../middleware/errorHandler';

const CategorySchema = z.object({ name: z.string().min(1), sortOrder: z.number().int().default(0) });
const ItemSchema = z.object({
  categoryId:  z.string().min(1),
  name:        z.string().min(1),
  description: z.string().optional(),
  priceExGst:  z.number().int().min(1),   // paise
  gstPercent:  z.number().min(0).max(28),
  isVeg:       z.boolean().default(true),
  isAlcohol:   z.boolean().default(false),
  imageUrl:    z.string().url().optional(),
  sortOrder:   z.number().int().default(0),
});

export async function getMenu(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const venue = await prisma.venue.findUnique({
      where: { id: req.params.venueId },
      select: { id: true },
    });
    if (!venue) throw new AppError('Venue not found', 404);

    const categories = await prisma.menuCategory.findMany({
      where: { venueId: req.params.venueId, isVisible: true },
      orderBy: { sortOrder: 'asc' },
      include: { items: { where: { isAvailable: true }, orderBy: { sortOrder: 'asc' } } },
    });
    ok(res, categories);
  } catch (e) { next(e); }
}

export async function getAdminMenu(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const categories = await prisma.menuCategory.findMany({
      where: { venueId: req.venue!.id },
      orderBy: { sortOrder: 'asc' },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    ok(res, { categories });
  } catch (e) { next(e); }
}

export async function createCategory(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = CategorySchema.parse(req.body);
    const cat = await prisma.menuCategory.create({ data: { venueId: req.venue!.id, ...data } });
    created(res, cat);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      next(new AppError('A menu item with this name already exists for this venue', 409));
      return;
    }
    next(e);
  }
}

export async function createItem(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = ItemSchema.parse(req.body);
    const category = await prisma.menuCategory.findFirst({
      where: { id: data.categoryId, venueId: req.venue!.id },
      select: { id: true },
    });
    if (!category) throw new AppError('Category not found', 404);
    const item = await prisma.menuItem.create({ data: { venueId: req.venue!.id, ...data } });
    created(res, item);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      next(new AppError('A menu item with this name already exists for this venue', 409));
      return;
    }
    next(e);
  }
}

export async function updateItem(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = ItemSchema.partial().parse(req.body);
    const item = await prisma.menuItem.findFirst({
      where: { id: req.params.itemId, venueId: req.venue!.id },
      select: { id: true },
    });
    if (!item) throw new AppError('Item not found', 404);

    if (data.categoryId) {
      const category = await prisma.menuCategory.findFirst({
        where: { id: data.categoryId, venueId: req.venue!.id },
        select: { id: true },
      });
      if (!category) throw new AppError('Category not found', 404);
    }

    const updated = await prisma.menuItem.update({ where: { id: item.id }, data });
    ok(res, updated);
  } catch (e) { next(e); }
}

export async function toggleItemAvailability(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const item = await prisma.menuItem.findFirst({ where: { id: req.params.itemId, venueId: req.venue!.id } });
    if (!item) throw new AppError('Item not found', 404);
    const updated = await prisma.menuItem.update({ where: { id: item.id }, data: { isAvailable: !item.isAvailable } });
    ok(res, { isAvailable: updated.isAvailable });
  } catch (e) { next(e); }
}

export async function deleteItem(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const item = await prisma.menuItem.findFirst({
      where: { id: req.params.itemId, venueId: req.venue!.id },
      select: { id: true },
    });
    if (!item) throw new AppError('Item not found', 404);
    await prisma.menuItem.delete({ where: { id: item.id } });
    ok(res, { message: 'Item deleted' });
  } catch (e) { next(e); }
}
