import { PartyParticipantRole, PartySessionStatus } from '@prisma/client';
import { AppError } from '../../src/middleware/errorHandler';
import { createPrismaMock } from '../helpers/mock-prisma';

const prismaMock = createPrismaMock();
const getGuestBillMock = vi.fn();

vi.mock('../../src/config/database', () => ({
  prisma: prismaMock,
}));

vi.mock('../../src/services/order.service', () => ({
  getGuestBill: getGuestBillMock,
}));

describe('party session service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a host participant when a session does not yet exist', async () => {
    const { ensurePartySessionForQueueEntry } = await import('../../src/services/partySession.service');

    prismaMock.partySession.findUnique.mockResolvedValue(null);
    prismaMock.partySession.create.mockResolvedValue({
      id: 'session_1',
      participants: [{ id: 'participant_1', role: PartyParticipantRole.HOST }],
    });

    const result = await ensurePartySessionForQueueEntry({
      queueEntryId: 'entry_1',
      venueId: 'venue_1',
      guestName: 'Neha',
      guestPhone: '9876543210',
    });

    expect(prismaMock.partySession.create).toHaveBeenCalled();
    expect(result.hostParticipant.id).toBe('participant_1');
  });

  it('joins a session from a public join token and returns a guest token payload', async () => {
    const { joinPartySessionByToken } = await import('../../src/services/partySession.service');

    prismaMock.partySession.findFirst.mockResolvedValue({
      id: 'session_1',
      status: PartySessionStatus.ACTIVE,
      queueEntry: {
        id: 'entry_1',
        venueId: 'venue_1',
        guestPhone: '9876543210',
      },
    });
    prismaMock.partyParticipant.create.mockResolvedValue({
      id: 'participant_2',
      displayName: 'Aman',
      role: PartyParticipantRole.MEMBER,
      isPayer: false,
    });

    const result = await joinPartySessionByToken({
      joinToken: 'join_123',
      displayName: 'Aman',
    });

    expect(result).toEqual(expect.objectContaining({
      sessionId: 'session_1',
      queueEntryId: 'entry_1',
      venueId: 'venue_1',
      participant: expect.objectContaining({
        id: 'participant_2',
        displayName: 'Aman',
      }),
      guestToken: expect.any(String),
    }));
  });

  it('normalizes bucket updates and removes items with zero quantity', async () => {
    const { updatePartyBucket } = await import('../../src/services/partySession.service');

    prismaMock.partyParticipant.findFirst.mockResolvedValue({
      id: 'participant_1',
      partySession: {
        id: 'session_1',
        status: PartySessionStatus.ACTIVE,
        queueEntry: {
          id: 'entry_1',
          status: 'SEATED',
          venueId: 'venue_1',
          guestName: 'Neha',
          guestPhone: '9876543210',
        },
      },
    });
    prismaMock.menuItem.findMany.mockResolvedValue([
      { id: 'item_1', isAvailable: true },
      { id: 'item_2', isAvailable: true },
    ]);
    prismaMock.partyBucketItem.findMany.mockResolvedValue([]);

    prismaMock.$transaction.mockImplementation(async (fn) => fn(prismaMock));

    await updatePartyBucket('session_1', {
      queueEntryId: 'entry_1',
      venueId: 'venue_1',
      guestPhone: '9876543210',
      partySessionId: 'session_1',
      participantId: 'participant_1',
    }, [
      { menuItemId: 'item_1', quantity: 2.7 },
      { menuItemId: 'item_2', quantity: 0 },
    ]);

    expect(prismaMock.partyBucketItem.deleteMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        menuItemId: { notIn: ['item_1'] },
      }),
    }));
    expect(prismaMock.partyBucketItem.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ menuItemId: 'item_1', quantity: 2 }),
      update: expect.objectContaining({ quantity: 2 }),
    }));
  });

  it('rejects unavailable menu items in the shared bucket', async () => {
    const { updatePartyBucket } = await import('../../src/services/partySession.service');

    prismaMock.partyParticipant.findFirst.mockResolvedValue({
      id: 'participant_1',
      partySession: {
        id: 'session_1',
        status: PartySessionStatus.ACTIVE,
        queueEntry: {
          id: 'entry_1',
          status: 'WAITING',
          venueId: 'venue_1',
          guestName: 'Neha',
          guestPhone: '9876543210',
        },
      },
    });
    prismaMock.menuItem.findMany.mockResolvedValue([{ id: 'item_1', isAvailable: false }]);

    await expect(updatePartyBucket('session_1', {
      queueEntryId: 'entry_1',
      venueId: 'venue_1',
      guestPhone: '9876543210',
      partySessionId: 'session_1',
      participantId: 'participant_1',
    }, [
      { menuItemId: 'item_1', quantity: 1 },
    ])).rejects.toMatchObject<AppError>({ code: 'PARTY_BUCKET_ITEM_UNAVAILABLE' });
  });

  it('returns a realtime payload with participants, bucket, and bill summary', async () => {
    const { getPartySessionRealtime } = await import('../../src/services/partySession.service');

    prismaMock.partyParticipant.findFirst.mockResolvedValue({
      id: 'participant_1',
      displayName: 'Neha',
      role: PartyParticipantRole.HOST,
      isPayer: true,
      partySession: {
        id: 'session_1',
        joinToken: 'join_123',
        status: PartySessionStatus.ACTIVE,
        queueEntry: {
          id: 'entry_1',
          status: 'SEATED',
          venueId: 'venue_1',
          guestName: 'Neha',
          guestPhone: '9876543210',
        },
      },
    });
    prismaMock.partyParticipant.update.mockResolvedValue({});
    prismaMock.partyParticipant.count.mockResolvedValue(2);
    prismaMock.partyParticipant.findMany.mockResolvedValue([{ id: 'participant_1' }, { id: 'participant_2' }]);
    prismaMock.partyBucketItem.findMany.mockResolvedValue([{ id: 'bucket_1', menuItemId: 'item_1', quantity: 2, updatedAt: new Date(), menuItem: { name: 'IPA' }, updatedBy: { id: 'participant_1' } }]);
    getGuestBillMock.mockResolvedValue({ summary: { balanceDue: 1_000 } });

    const realtime = await getPartySessionRealtime('session_1', {
      queueEntryId: 'entry_1',
      venueId: 'venue_1',
      guestPhone: '9876543210',
      partySessionId: 'session_1',
      participantId: 'participant_1',
    });

    expect(realtime).toEqual(expect.objectContaining({
      session: expect.objectContaining({ id: 'session_1', participantCount: 2 }),
      participants: expect.any(Array),
      bucket: expect.any(Array),
      billSummary: { balanceDue: 1_000 },
    }));
  });
});
