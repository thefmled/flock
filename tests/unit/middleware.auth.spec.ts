import type { NextFunction, Response } from 'express';
import { StaffRole } from '@prisma/client';
import { createPrismaMock } from '../helpers/mock-prisma';

const prismaMock = createPrismaMock();
const verifyTokenMock = vi.fn();

vi.mock('../../src/config/database', () => ({
  prisma: prismaMock,
}));

vi.mock('../../src/utils/jwt', () => ({
  verifyToken: verifyTokenMock,
}));

function createResponseMock() {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

describe('auth middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('attaches staff auth context for valid bearer tokens', async () => {
    const { requireAuth } = await import('../../src/middleware/auth');

    verifyTokenMock.mockReturnValue({
      kind: 'staff',
      staffId: 'staff_1',
      venueId: 'venue_1',
      role: StaffRole.MANAGER,
    });
    prismaMock.staff.findFirst.mockResolvedValue({
      id: 'staff_1',
      venueId: 'venue_1',
      role: StaffRole.MANAGER,
      venue: { id: 'venue_1', name: 'Flock' },
    });

    const req: any = {
      headers: { authorization: 'Bearer token' },
    };
    const res = createResponseMock();
    const next = vi.fn() as NextFunction;

    await requireAuth(req, res, next);

    expect(req.staff.id).toBe('staff_1');
    expect(req.venue.id).toBe('venue_1');
    expect(next).toHaveBeenCalled();
  });

  it('rejects guest tokens whose queue entry does not match the token claims', async () => {
    const { requireGuestAuth } = await import('../../src/middleware/auth');

    verifyTokenMock.mockReturnValue({
      kind: 'guest',
      queueEntryId: 'entry_1',
      venueId: 'venue_1',
      guestPhone: '9876543210',
      partySessionId: 'session_1',
      participantId: 'participant_1',
    });
    prismaMock.queueEntry.findUnique.mockResolvedValue({
      id: 'entry_1',
      venueId: 'venue_other',
      guestPhone: '9876543210',
    });

    const req: any = {
      headers: { authorization: 'Bearer token' },
    };
    const res = createResponseMock();
    const next = vi.fn() as NextFunction;

    await requireGuestAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('validates guest participant membership for party-session access', async () => {
    const { requireGuestAuth } = await import('../../src/middleware/auth');

    verifyTokenMock.mockReturnValue({
      kind: 'guest',
      queueEntryId: 'entry_1',
      venueId: 'venue_1',
      guestPhone: '9876543210',
      partySessionId: 'session_1',
      participantId: 'participant_1',
    });
    prismaMock.queueEntry.findUnique.mockResolvedValue({
      id: 'entry_1',
      venueId: 'venue_1',
      guestPhone: '9876543210',
    });
    prismaMock.partyParticipant.findFirst.mockResolvedValue({ id: 'participant_1' });

    const req: any = {
      headers: { authorization: 'Bearer token' },
    };
    const res = createResponseMock();
    const next = vi.fn() as NextFunction;

    await requireGuestAuth(req, res, next);

    expect(req.guest).toEqual({
      queueEntryId: 'entry_1',
      venueId: 'venue_1',
      guestPhone: '9876543210',
      partySessionId: 'session_1',
      participantId: 'participant_1',
    });
    expect(next).toHaveBeenCalled();
  });
});
