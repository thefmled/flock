import jwt from 'jsonwebtoken';
import { StaffRole } from '@prisma/client';
import { env } from '../config/env';

export interface StaffJwtPayload {
  kind: 'staff';
  staffId: string;
  venueId: string;
  role: StaffRole;
}

export interface GuestJwtPayload {
  kind: 'guest';
  queueEntryId: string;
  venueId: string;
  guestPhone: string;
  partySessionId?: string;
  participantId?: string;
}

export type JwtPayload = StaffJwtPayload | GuestJwtPayload;

export function signStaffToken(payload: StaffJwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN } as jwt.SignOptions);
}

export function signGuestToken(payload: GuestJwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.GUEST_JWT_EXPIRES_IN } as jwt.SignOptions);
}

export function signToken(payload: JwtPayload): string {
  return payload.kind === 'guest' ? signGuestToken(payload) : signStaffToken(payload);
}

export function verifyToken(token: string): JwtPayload {
  const payload = jwt.verify(token, env.JWT_SECRET) as Record<string, unknown>;

  if (payload.kind === 'guest') {
    return {
      kind: 'guest',
      queueEntryId: String(payload.queueEntryId),
      venueId: String(payload.venueId),
      guestPhone: String(payload.guestPhone),
      partySessionId: payload.partySessionId ? String(payload.partySessionId) : undefined,
      participantId: payload.participantId ? String(payload.participantId) : undefined,
    };
  }

  if (payload.kind === 'staff' || (payload.staffId && payload.venueId && payload.role)) {
    return {
      kind: 'staff',
      staffId: String(payload.staffId),
      venueId: String(payload.venueId),
      role: payload.role as StaffRole,
    };
  }

  throw new Error('Invalid token payload');
}
