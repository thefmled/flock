import { createPrismaMock } from '../helpers/mock-prisma';

const prismaMock = createPrismaMock();

vi.mock('../../src/config/database', () => ({
  prisma: prismaMock,
}));

describe('venue service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a unique slug when the base slug already exists', async () => {
    const { createVenue } = await import('../../src/services/venue.service');

    prismaMock.venue.findUnique
      .mockResolvedValueOnce({ id: 'venue_existing' })
      .mockResolvedValueOnce(null);
    prismaMock.venue.create.mockResolvedValue({ id: 'venue_2', slug: 'the-barrel-room-1' });

    const result = await createVenue({
      name: 'The Barrel Room',
      address: '12 Main Street',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
      phone: '9876543210',
      email: 'venue@example.com',
      licenceType: 'LICENSED_BAR',
      depositPercent: 75,
    });

    expect(prismaMock.venue.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ slug: 'the-barrel-room-1' }),
    }));
    expect(result.slug).toBe('the-barrel-room-1');
  });

  it('calculates daily stats from IST day boundaries', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-09T18:45:00.000Z'));

    const { getVenueStats } = await import('../../src/services/venue.service');

    prismaMock.queueEntry.aggregate.mockResolvedValue({
      _count: { _all: 14 },
      _avg: { estimatedWaitMin: 27.4 },
    });
    prismaMock.table.groupBy.mockResolvedValue([
      { status: 'FREE', _count: { _all: 6 } },
      { status: 'OCCUPIED', _count: { _all: 4 } },
    ]);
    prismaMock.payment.aggregate.mockResolvedValue({
      _count: { _all: 8 },
      _sum: { amount: 88_000, platformFeeAmount: 1_760 },
    });

    const stats = await getVenueStats('venue_1');

    expect(prismaMock.queueEntry.aggregate).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        venueId: 'venue_1',
        joinedAt: expect.objectContaining({ gte: new Date('2026-03-09T18:30:00.000Z') }),
      }),
    }));
    expect(stats).toEqual({
      today: {
        totalQueueJoins: 14,
        avgWaitMin: 27,
        totalPayments: 8,
        totalRevenuePaise: 88_000,
        platformFeePaise: 1_760,
      },
      tables: {
        FREE: 6,
        OCCUPIED: 4,
      },
    });

    vi.useRealTimers();
  });
});
