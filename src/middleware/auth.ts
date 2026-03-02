import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import { verifyToken } from '../utils/jwt';
import { prisma } from '../config/database';
import { unauthorized, forbidden } from '../utils/response';
import { StaffRole } from '@prisma/client';

function getBearerToken(req: AuthenticatedRequest): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7);
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = getBearerToken(req);
  if (!token) {
    unauthorized(res);
    return;
  }
  try {
    const payload = verifyToken(token);
    if (payload.kind !== 'staff') {
      unauthorized(res, 'Invalid token kind');
      return;
    }
    const staff = await prisma.staff.findFirst({
      where: { id: payload.staffId, venueId: payload.venueId, isActive: true },
      include: { venue: true },
    });
    if (!staff) { unauthorized(res); return; }
    req.staff = staff;
    req.venue = staff.venue;
    next();
  } catch {
    unauthorized(res, 'Invalid or expired token');
  }
}

export async function requireGuestAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = getBearerToken(req);
  if (!token) {
    unauthorized(res);
    return;
  }

  try {
    const payload = verifyToken(token);
    if (payload.kind !== 'guest') {
      unauthorized(res, 'Invalid token kind');
      return;
    }

    const entry = await prisma.queueEntry.findUnique({
      where: { id: payload.queueEntryId },
      select: { id: true, venueId: true, guestPhone: true },
    });

    if (!entry || entry.venueId !== payload.venueId || entry.guestPhone !== payload.guestPhone) {
      unauthorized(res, 'Guest session invalid');
      return;
    }

    req.guest = {
      queueEntryId: entry.id,
      venueId: entry.venueId,
      guestPhone: entry.guestPhone,
    };

    next();
  } catch {
    unauthorized(res, 'Invalid or expired token');
  }
}

export async function requireGuestOrStaffAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = getBearerToken(req);
  if (!token) {
    unauthorized(res);
    return;
  }

  try {
    const payload = verifyToken(token);

    if (payload.kind === 'staff') {
      const staff = await prisma.staff.findFirst({
        where: { id: payload.staffId, venueId: payload.venueId, isActive: true },
        include: { venue: true },
      });
      if (!staff) {
        unauthorized(res);
        return;
      }
      req.staff = staff;
      req.venue = staff.venue;
      next();
      return;
    }

    const entry = await prisma.queueEntry.findUnique({
      where: { id: payload.queueEntryId },
      select: { id: true, venueId: true, guestPhone: true },
    });

    if (!entry || entry.venueId !== payload.venueId || entry.guestPhone !== payload.guestPhone) {
      unauthorized(res, 'Guest session invalid');
      return;
    }

    req.guest = {
      queueEntryId: entry.id,
      venueId: entry.venueId,
      guestPhone: entry.guestPhone,
    };
    next();
  } catch {
    unauthorized(res, 'Invalid or expired token');
  }
}

export function requireRole(...roles: StaffRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.staff || !roles.includes(req.staff.role)) {
      forbidden(res, `Requires role: ${roles.join(' or ')}`);
      return;
    }
    next();
  };
}
