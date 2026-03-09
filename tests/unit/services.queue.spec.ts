import { QueueEntryStatus, TableStatus } from '@prisma/client';
import { AppError } from '../../src/middleware/errorHandler';
import { createPrismaMock } from '../helpers/mock-prisma';

const prismaMock = createPrismaMock();
const redisMock = {
  set: vi.fn(),
  publish: vi.fn(),
  del: vi.fn(),
};
const notifyMock = {
  queueJoined: vi.fn(),
  tableReady: vi.fn(),
};
const isRedisReadyMock = vi.fn(() => false);
const ensurePartySessionForQueueEntryMock = vi.fn();
const syncPendingPreOrderForSeatingMock = vi.fn();
const signGuestTokenMock = vi.fn(() => 'guest-token');
const initiateRefundMock = vi.fn();
const logFlowEventMock = vi.fn();

vi.mock('../../src/config/database', () => ({
  prisma: prismaMock,
}));

vi.mock('../../src/config/redis', () => ({
  redis: redisMock,
  RedisKeys: {
    queueEntry: (entryId: string) => `queue:${entryId}`,
  },
  PubSubChannels: {
    queueUpdate: (venueId: string) => `queue:${venueId}`,
    tableUpdate: (venueId: string) => `table:${venueId}`,
  },
  isRedisReady: isRedisReadyMock,
}));

vi.mock('../../src/integrations/notifications', () => ({
  Notify: notifyMock,
}));

vi.mock('../../src/services/partySession.service', () => ({
  ensurePartySessionForQueueEntry: ensurePartySessionForQueueEntryMock,
}));

vi.mock('../../src/services/order.service', () => ({
  syncPendingPreOrderForSeating: syncPendingPreOrderForSeatingMock,
}));

vi.mock('../../src/utils/jwt', () => ({
  signGuestToken: signGuestTokenMock,
}));

vi.mock('../../src/integrations/razorpay', async () => {
  const actual = await vi.importActual<typeof import('../../src/integrations/razorpay')>('../../src/integrations/razorpay');
  return {
    ...actual,
    initiateRefund: initiateRefundMock,
  };
});

vi.mock('../../src/services/orderFlowEvent.service', () => ({
  OrderFlowEventType: {
    QUEUE_JOINED: 'QUEUE_JOINED',
    GUEST_SEATED: 'GUEST_SEATED',
    ENTRY_CANCELLED: 'ENTRY_CANCELLED',
    ENTRY_COMPLETED: 'ENTRY_COMPLETED',
  },
  logFlowEvent: logFlowEventMock,
}));

describe('queue service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isRedisReadyMock.mockReturnValue(false);
    ensurePartySessionForQueueEntryMock.mockResolvedValue({
      session: { id: 'session_1' },
      hostParticipant: { id: 'participant_1' },
    });
    syncPendingPreOrderForSeatingMock.mockResolvedValue({
      attempted: false,
      status: 'no_preorder',
    });
  });

  it('joins the queue, assigns position, and issues a guest token', async () => {
    const { joinQueue } = await import('../../src/services/queue.service');

    prismaMock.venue.findUnique.mockResolvedValue({
      id: 'venue_1',
      name: 'Flock',
      isQueueOpen: true,
      maxQueueSize: 200,
    });
    prismaMock.queueEntry.count.mockResolvedValue(2);
    prismaMock.queueEntry.findFirst.mockResolvedValue(null);
    prismaMock.queueEntry.create.mockResolvedValue({
      id: 'entry_1',
      venueId: 'venue_1',
      guestName: 'Neha',
      guestPhone: '9876543210',
    });

    const result = await joinQueue({
      venueId: 'venue_1',
      guestName: 'Neha',
      guestPhone: '9876543210',
      partySize: 3,
    });

    expect(result).toEqual(expect.objectContaining({
      id: 'entry_1',
      position: 3,
      estimatedWaitMin: 116,
      guestToken: 'guest-token',
    }));
    expect(prismaMock.queueEntry.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        position: 3,
        partySize: 3,
        displayRef: expect.stringMatching(/^FLK-/),
      }),
    }));
    expect(notifyMock.queueJoined).toHaveBeenCalled();
  });

  it('rejects duplicate active phones in the queue', async () => {
    const { joinQueue } = await import('../../src/services/queue.service');

    prismaMock.venue.findUnique.mockResolvedValue({
      id: 'venue_1',
      name: 'Flock',
      isQueueOpen: true,
      maxQueueSize: 200,
    });
    prismaMock.queueEntry.count.mockResolvedValue(1);
    prismaMock.queueEntry.findFirst.mockResolvedValue({ id: 'entry_existing' });

    await expect(joinQueue({
      venueId: 'venue_1',
      guestName: 'Neha',
      guestPhone: '9876543210',
      partySize: 2,
    })).rejects.toMatchObject<AppError>({ code: 'ALREADY_IN_QUEUE' });
  });

  it('seats a guest, re-compacts the queue, and syncs preorder state', async () => {
    const { seatGuest } = await import('../../src/services/queue.service');

    prismaMock.queueEntry.findFirst.mockResolvedValue({
      id: 'entry_1',
      guestName: 'Neha',
      venueId: 'venue_1',
      status: QueueEntryStatus.WAITING,
    });
    prismaMock.table.findFirst.mockResolvedValue({
      id: 'table_1',
      label: 'T1',
      status: TableStatus.FREE,
    });
    prismaMock.queueEntry.findMany.mockResolvedValue([
      { id: 'entry_2', joinedAt: new Date('2026-03-09T10:00:00.000Z') },
      { id: 'entry_3', joinedAt: new Date('2026-03-09T10:05:00.000Z') },
    ]);
    syncPendingPreOrderForSeatingMock.mockResolvedValue({
      attempted: true,
      status: 'manual_fallback',
    });

    const result = await seatGuest({
      venueId: 'venue_1',
      otp: '123456',
      tableId: 'table_1',
    });

    expect(prismaMock.queueEntry.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'entry_1' },
      data: expect.objectContaining({ status: QueueEntryStatus.SEATED, tableId: 'table_1' }),
    }));
    expect(prismaMock.queueEntry.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'entry_2' },
      data: expect.objectContaining({ position: 1, estimatedWaitMin: 39 }),
    }));
    expect(syncPendingPreOrderForSeatingMock).toHaveBeenCalledWith({
      venueId: 'venue_1',
      queueEntryId: 'entry_1',
      tableId: 'T1',
    });
    expect(result.preOrderSync.status).toBe('manual_fallback');
  });

  it('cancels waiting entries and attempts an auto-refund when a deposit exists', async () => {
    const { cancelQueueEntry } = await import('../../src/services/queue.service');

    prismaMock.queueEntry.findFirst.mockResolvedValue({
      id: 'entry_1',
      venueId: 'venue_1',
      status: QueueEntryStatus.WAITING,
      tableId: 'table_1',
    });
    prismaMock.payment.findFirst
      .mockResolvedValueOnce({
        id: 'payment_1',
        amount: 10_000,
        razorpayPaymentId: 'rzp_payment_1',
      })
      .mockResolvedValueOnce(null);
    prismaMock.table.findUnique.mockResolvedValue({
      id: 'table_1',
      status: TableStatus.RESERVED,
    });
    prismaMock.queueEntry.findMany.mockResolvedValue([]);
    initiateRefundMock.mockResolvedValue({ id: 'refund_1' });

    const result = await cancelQueueEntry('entry_1', 'venue_1');

    expect(result).toEqual(expect.objectContaining({
      queueCancelled: true,
      refundStatus: 'refunded',
      refundedPaymentId: 'payment_1',
      refundId: 'refund_1',
    }));
    expect(prismaMock.payment.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'payment_1' },
      data: expect.objectContaining({ status: 'REFUNDED', refundAmount: 10_000 }),
    }));
  });
});
