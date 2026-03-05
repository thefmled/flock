import { prisma } from '../config/database';
import { redis, RedisKeys } from '../config/redis';
import { env } from '../config/env';
import { generateOtp } from '../utils/otp';
import { signToken } from '../utils/jwt';
import { Notify } from '../integrations/notifications';
import { AppError } from '../middleware/errorHandler';
import { StaffRole } from '@prisma/client';

const MAX_OTP_ATTEMPTS = 5;

// ── Guest OTP (queue join) ─────────────────────────────────────────

export async function sendGuestOtp(phone: string, venueId: string): Promise<string> {
  const venue = await prisma.venue.findUnique({ where: { id: venueId } });
  if (!venue) throw new AppError('Venue not found', 404);

  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + env.OTP_EXPIRES_SECONDS * 1000);

  await prisma.otpCode.create({
    data: { phone, code: otp, purpose: 'GUEST_QUEUE', venueId, expiresAt },
  });

  await Notify.otp(venueId, phone, otp, venue.name);
  return otp;
}

export async function verifyGuestOtp(phone: string, code: string, venueId: string): Promise<boolean> {
  const record = await prisma.otpCode.findFirst({
    where: { phone, purpose: 'GUEST_QUEUE', venueId, verified: false, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });

  if (!record) throw new AppError('OTP expired or not found', 400, 'OTP_INVALID');
  if (record.attempts >= MAX_OTP_ATTEMPTS) throw new AppError('Too many attempts', 429, 'OTP_TOO_MANY_ATTEMPTS');

  if (record.code !== code) {
    await prisma.otpCode.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
    throw new AppError('Incorrect OTP', 400, 'OTP_INCORRECT');
  }

  await prisma.otpCode.update({ where: { id: record.id }, data: { verified: true } });
  return true;
}

// ── Staff OTP login ────────────────────────────────────────────────

export async function sendStaffOtp(phone: string, venueId: string): Promise<string> {
  const staff = await prisma.staff.findFirst({ where: { phone, venueId, isActive: true }, include: { venue: true } });
  if (!staff) throw new AppError('Staff not found at this venue', 404);

  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + env.OTP_EXPIRES_SECONDS * 1000);

  await prisma.otpCode.create({
    data: { phone, code: otp, purpose: 'STAFF_LOGIN', venueId, staffId: staff.id, expiresAt },
  });

  await Notify.otp(venueId, phone, otp, staff.venue.name);
  return otp;
}

export async function verifyStaffOtp(phone: string, code: string, venueId: string): Promise<{ token: string; staff: object }> {
  const record = await prisma.otpCode.findFirst({
    where: { phone, purpose: 'STAFF_LOGIN', venueId, verified: false, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    include: { staff: true },
  });

  if (!record || !record.staff) throw new AppError('OTP expired or not found', 400, 'OTP_INVALID');
  if (record.attempts >= MAX_OTP_ATTEMPTS) throw new AppError('Too many attempts', 429);

  if (record.code !== code) {
    await prisma.otpCode.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
    throw new AppError('Incorrect OTP', 400, 'OTP_INCORRECT');
  }

  await prisma.otpCode.update({ where: { id: record.id }, data: { verified: true } });
  await prisma.staff.update({ where: { id: record.staff.id }, data: { lastLoginAt: new Date() } });

  const token = signToken({ kind: 'staff', staffId: record.staff.id, venueId, role: record.staff.role });
  return { token, staff: { id: record.staff.id, name: record.staff.name, role: record.staff.role } };
}
