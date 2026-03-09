import { StaffRole } from '@prisma/client';
import { generateOtp, generateSeatingOtp } from '../../src/utils/otp';
import { generateDisplayRef, generateInvoiceNumber, generateTxnRef } from '../../src/utils/txnRef';
import { signGuestToken, signStaffToken, verifyToken } from '../../src/utils/jwt';

describe('identity and token helpers', () => {
  it('generates six-digit OTPs', () => {
    expect(generateOtp()).toMatch(/^\d{6}$/);
    expect(generateSeatingOtp()).toMatch(/^\d{6}$/);
  });

  it('signs and verifies staff tokens', () => {
    const token = signStaffToken({
      kind: 'staff',
      staffId: 'staff_1',
      venueId: 'venue_1',
      role: StaffRole.MANAGER,
    });

    expect(verifyToken(token)).toEqual({
      kind: 'staff',
      staffId: 'staff_1',
      venueId: 'venue_1',
      role: StaffRole.MANAGER,
    });
  });

  it('signs and verifies guest tokens with party-session context', () => {
    const token = signGuestToken({
      kind: 'guest',
      queueEntryId: 'entry_1',
      venueId: 'venue_1',
      guestPhone: '9876543210',
      partySessionId: 'session_1',
      participantId: 'participant_1',
    });

    expect(verifyToken(token)).toEqual({
      kind: 'guest',
      queueEntryId: 'entry_1',
      venueId: 'venue_1',
      guestPhone: '9876543210',
      partySessionId: 'session_1',
      participantId: 'participant_1',
    });
  });

  it('generates stable ID formats for txn refs, display refs, and invoices', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-09T10:00:00.000Z'));

    expect(generateTxnRef()).toMatch(/^FLK-[A-Z0-9]+-[A-Z0-9]{4}$/);
    expect(generateDisplayRef()).toMatch(/^FLK-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    expect(generateInvoiceNumber(42)).toBe('FLOCK/2025-26/00042');

    vi.useRealTimers();
  });
});
