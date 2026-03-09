import { invokeApp } from '../helpers/invoke-app';

const { authServiceMock } = vi.hoisted(() => ({
  authServiceMock: {
    sendGuestOtp: vi.fn(),
    sendStaffOtp: vi.fn(),
    verifyStaffOtp: vi.fn(),
  },
}));

vi.mock('../../src/services/auth.service', () => authServiceMock);

describe('auth routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends guest and staff OTPs with mockOtp in test mode', async () => {
    authServiceMock.sendGuestOtp.mockResolvedValue('123456');
    authServiceMock.sendStaffOtp.mockResolvedValue('654321');
    const app = (await import('../../src/app')).default;

    const guest = await invokeApp(app, {
      method: 'POST',
      url: '/api/v1/auth/guest/otp/send',
      body: { phone: '9876543210', venueId: 'venue_1' },
    });

    const staff = await invokeApp(app, {
      method: 'POST',
      url: '/api/v1/auth/staff/otp/send',
      body: { phone: '9876543211', venueId: 'venue_1' },
    });

    expect(guest.status).toBe(200);
    expect(staff.status).toBe(200);
    expect(guest.body.data.mockOtp).toBe('123456');
    expect(staff.body.data.mockOtp).toBe('654321');
  });

  it('verifies staff OTPs and validates malformed payloads', async () => {
    authServiceMock.verifyStaffOtp.mockResolvedValue({
      token: 'staff-token',
      staff: { id: 'staff_1', name: 'Manager', role: 'MANAGER' },
    });
    const app = (await import('../../src/app')).default;

    const valid = await invokeApp(app, {
      method: 'POST',
      url: '/api/v1/auth/staff/otp/verify',
      body: { phone: '9876543210', code: '123456', venueId: 'venue_1' },
    });
    expect(valid.status).toBe(200);

    const invalid = await invokeApp(app, {
      method: 'POST',
      url: '/api/v1/auth/staff/otp/verify',
      body: { phone: 'bad', code: '1', venueId: '' },
    });

    expect(invalid.status).toBe(400);
    expect(invalid.body.code).toBe('VALIDATION_ERROR');
  });
});
