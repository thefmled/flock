import { invokeApp } from '../helpers/invoke-app';

const {
  queueServiceMock,
  orderFlowEventServiceMock,
  partySessionServiceMock,
} = vi.hoisted(() => ({
  queueServiceMock: {
    joinQueue: vi.fn(),
    getVenueQueue: vi.fn(),
    getQueueEntry: vi.fn(),
    reissueGuestSession: vi.fn(),
    seatGuest: vi.fn(),
    cancelQueueEntry: vi.fn(),
    completeQueueEntry: vi.fn(),
    getRecentCompletedEntries: vi.fn(),
  },
  orderFlowEventServiceMock: {
    getFlowEvents: vi.fn(),
  },
  partySessionServiceMock: {
    joinPartySessionByToken: vi.fn(),
    getPartySessionRealtime: vi.fn(),
    getPartySessionSummary: vi.fn(),
    getPartyParticipants: vi.fn(),
    getPartyBucket: vi.fn(),
    updatePartyBucket: vi.fn(),
  },
}));

vi.mock('../../src/services/queue.service', () => queueServiceMock);
vi.mock('../../src/services/orderFlowEvent.service', () => orderFlowEventServiceMock);
vi.mock('../../src/services/partySession.service', () => partySessionServiceMock);

vi.mock('../../src/middleware/auth', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (req.header('authorization') !== 'Bearer staff-token') {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    req.staff = { id: 'staff_1', role: 'MANAGER', venueId: 'venue_1' };
    req.venue = { id: 'venue_1', slug: 'the-barrel-room-koramangala' };
    next();
  },
  requireGuestAuth: (req: any, res: any, next: any) => {
    if (req.header('authorization') !== 'Bearer guest-token') {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    req.guest = {
      queueEntryId: 'entry_1',
      venueId: 'venue_1',
      guestPhone: '9876543210',
      partySessionId: 'session_1',
      participantId: 'participant_1',
    };
    next();
  },
  requireGuestOrStaffAuth: (req: any, res: any, next: any) => {
    if (req.header('authorization') === 'Bearer staff-token') {
      req.staff = { id: 'staff_1', role: 'MANAGER', venueId: 'venue_1' };
      req.venue = { id: 'venue_1', slug: 'the-barrel-room-koramangala' };
      next();
      return;
    }
    if (req.header('authorization') === 'Bearer guest-token') {
      req.guest = {
        queueEntryId: 'entry_1',
        venueId: 'venue_1',
        guestPhone: '9876543210',
      };
      next();
      return;
    }
    res.status(401).json({ success: false, error: 'Unauthorized' });
  },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

describe('queue and party-session routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('covers queue join, live queue, session recovery, and flow history', async () => {
    queueServiceMock.joinQueue.mockResolvedValue({
      id: 'entry_1',
      otp: '123456',
      position: 1,
      estimatedWaitMin: 39,
      guestToken: 'guest-token',
    });
    queueServiceMock.getVenueQueue.mockResolvedValue([{ id: 'entry_1' }]);
    queueServiceMock.reissueGuestSession.mockResolvedValue({ guestToken: 'guest-token-2' });
    queueServiceMock.getRecentCompletedEntries.mockResolvedValue([{ id: 'entry_history' }]);
    orderFlowEventServiceMock.getFlowEvents.mockResolvedValue([{ id: 'flow_1' }]);

    const app = (await import('../../src/app')).default;

    const joined = await invokeApp(app, {
      method: 'POST',
      url: '/api/v1/queue',
      body: { venueId: 'venue_1', guestName: 'Neha', guestPhone: '9876543210', partySize: 2 },
    });
    expect(joined.status).toBe(201);

    const live = await invokeApp(app, {
      method: 'GET',
      url: '/api/v1/queue/live',
      headers: { authorization: 'Bearer staff-token' },
    });
    expect(live.status).toBe(200);
    expect(live.body.meta.count).toBe(1);

    expect((await invokeApp(app, {
      method: 'POST',
      url: '/api/v1/queue/entry_1/session',
      body: { otp: '123456' },
    })).status).toBe(200);

    expect((await invokeApp(app, {
      method: 'GET',
      url: '/api/v1/queue/history/recent',
      headers: { authorization: 'Bearer staff-token' },
    })).status).toBe(200);

    expect((await invokeApp(app, {
      method: 'GET',
      url: '/api/v1/queue/entry_1/flow',
      headers: { authorization: 'Bearer staff-token' },
    })).status).toBe(200);
  });

  it('guards guest-only queue entry access and covers seating/cancellation/checkout', async () => {
    queueServiceMock.getQueueEntry.mockResolvedValue({ id: 'entry_1', status: 'WAITING' });
    queueServiceMock.seatGuest.mockResolvedValue({ entryId: 'entry_1', guestName: 'Neha', preOrderSync: { attempted: false, status: 'no_preorder' } });
    queueServiceMock.cancelQueueEntry.mockResolvedValue({ queueCancelled: true, refundStatus: 'not_needed' });
    queueServiceMock.completeQueueEntry.mockResolvedValue(undefined);

    const app = (await import('../../src/app')).default;

    expect((await invokeApp(app, {
      method: 'GET',
      url: '/api/v1/queue/entry_1',
      headers: { authorization: 'Bearer guest-token' },
    })).status).toBe(200);

    const forbidden = await invokeApp(app, {
      method: 'GET',
      url: '/api/v1/queue/entry_2',
      headers: { authorization: 'Bearer guest-token' },
    });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error).toContain('Guest session');

    expect((await invokeApp(app, {
      method: 'POST',
      url: '/api/v1/queue/seat',
      headers: { authorization: 'Bearer staff-token' },
      body: { otp: '123456', tableId: 'table_1' },
    })).status).toBe(200);

    expect((await invokeApp(app, {
      method: 'DELETE',
      url: '/api/v1/queue/entry_1',
      headers: { authorization: 'Bearer staff-token' },
    })).status).toBe(200);

    expect((await invokeApp(app, {
      method: 'POST',
      url: '/api/v1/queue/entry_1/checkout',
      headers: { authorization: 'Bearer staff-token' },
    })).status).toBe(200);
  });

  it('covers party-session join, realtime reads, and bucket mutation validation', async () => {
    partySessionServiceMock.joinPartySessionByToken.mockResolvedValue({ sessionId: 'session_1', guestToken: 'guest-token' });
    partySessionServiceMock.getPartySessionRealtime.mockResolvedValue({ session: { id: 'session_1' }, participants: [], bucket: [], billSummary: null });
    partySessionServiceMock.getPartySessionSummary.mockResolvedValue({ id: 'session_1', participantCount: 2 });
    partySessionServiceMock.getPartyParticipants.mockResolvedValue([{ id: 'participant_1' }]);
    partySessionServiceMock.getPartyBucket.mockResolvedValue([{ menuItemId: 'item_1', quantity: 2 }]);
    partySessionServiceMock.updatePartyBucket.mockResolvedValue([{ menuItemId: 'item_1', quantity: 3 }]);

    const app = (await import('../../src/app')).default;

    expect((await invokeApp(app, {
      method: 'POST',
      url: '/api/v1/party-sessions/join/join_123',
      body: { displayName: 'Aman' },
    })).status).toBe(201);

    expect((await invokeApp(app, {
      method: 'GET',
      url: '/api/v1/party-sessions/session_1/realtime',
      headers: { authorization: 'Bearer guest-token' },
    })).status).toBe(200);

    expect((await invokeApp(app, {
      method: 'GET',
      url: '/api/v1/party-sessions/session_1',
      headers: { authorization: 'Bearer guest-token' },
    })).status).toBe(200);

    expect((await invokeApp(app, {
      method: 'GET',
      url: '/api/v1/party-sessions/session_1/participants',
      headers: { authorization: 'Bearer guest-token' },
    })).status).toBe(200);

    expect((await invokeApp(app, {
      method: 'GET',
      url: '/api/v1/party-sessions/session_1/bucket',
      headers: { authorization: 'Bearer guest-token' },
    })).status).toBe(200);

    expect((await invokeApp(app, {
      method: 'PUT',
      url: '/api/v1/party-sessions/session_1/bucket',
      headers: { authorization: 'Bearer guest-token' },
      body: { items: [{ menuItemId: 'item_1', quantity: 3 }] },
    })).status).toBe(200);

    expect((await invokeApp(app, {
      method: 'PUT',
      url: '/api/v1/party-sessions/session_1/bucket',
      headers: { authorization: 'Bearer guest-token' },
      body: { items: [{ menuItemId: '', quantity: -1 }] },
    })).status).toBe(400);
  });
});
