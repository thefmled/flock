import { createPrismaMock } from '../helpers/mock-prisma';
import { invokeApp } from '../helpers/invoke-app';

const prismaMock = createPrismaMock();
const isRedisReadyMock = vi.fn(() => false);

vi.mock('../../src/config/database', () => ({
  prisma: prismaMock,
}));

vi.mock('../../src/config/redis', () => ({
  isRedisReady: isRedisReadyMock,
}));

describe('index routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns degraded health when redis is unavailable but db responds', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    const app = (await import('../../src/app')).default;

    const response = await invokeApp(app, { method: 'GET', url: '/api/v1/health' });

    expect(response.status).toBe(200);
    expect(response.body.data ?? response.body).toMatchObject({
      status: 'degraded',
      db: 'ok',
      redis: 'degraded',
      service: 'flock-api',
    });
  });

  it('proxies QR images and exposes internal test state behind onboarding auth', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'image/png' }),
      arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
    } as Response);

    prismaMock.otpCode.findFirst.mockResolvedValue({
      code: '123456',
      purpose: 'STAFF_LOGIN',
      createdAt: new Date('2026-03-09T10:00:00.000Z'),
      expiresAt: new Date('2026-03-09T10:05:00.000Z'),
      verified: false,
      attempts: 0,
      venueId: 'venue_1',
    });
    prismaMock.$queryRaw.mockResolvedValue([
      { migration_name: 'migration_1', finished_at: new Date('2026-03-09T10:00:00.000Z') },
    ]);

    const app = (await import('../../src/app')).default;

    const qr = await invokeApp(app, {
      method: 'GET',
      url: '/api/v1/share/qr?data=https://flock.in/test',
    });
    expect(qr.status).toBe(200);
    expect(qr.headers['content-type']).toMatch(/image\/png/);

    const testState = await invokeApp(app, {
      method: 'GET',
      url: '/api/v1/internal/test-state?phone=9876543210',
      headers: {
        'x-flock-onboarding-token': process.env.ONBOARDING_TOKEN!,
      },
    });

    expect(testState.status).toBe(200);
    expect(testState.body.data.latestOtp.code).toBe('123456');
  });

  it('returns route not found for unknown paths', async () => {
    const app = (await import('../../src/app')).default;

    const response = await invokeApp(app, { method: 'GET', url: '/api/v1/does-not-exist' });
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('ROUTE_NOT_FOUND');
  });
});
