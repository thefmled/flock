function createResponseMock() {
  const headers = new Map();
  const response = {
    statusCode: 200,
    body: null,
    setHeader: vi.fn((key, value) => {
      headers.set(String(key).toLowerCase(), value);
    }),
    getHeader: vi.fn((key) => headers.get(String(key).toLowerCase())),
    hasHeader: vi.fn((key) => headers.has(String(key).toLowerCase())),
    removeHeader: vi.fn((key) => headers.delete(String(key).toLowerCase())),
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return response;
}

async function invokeLimiter(limiter, reqOverrides = {}) {
  const req = {
    method: 'POST',
    path: '/otp/send',
    ip: '127.0.0.1',
    body: {},
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    ...reqOverrides,
  };
  const res = createResponseMock();
  const next = vi.fn();

  await limiter(req, res, next);

  return { req, res, next };
}

describe('rate limiter middleware', () => {
  it('limits OTP sends per phone number', async () => {
    const { otpSendLimiter } = await import('../../src/middleware/rateLimiter');

    const first = await invokeLimiter(otpSendLimiter, {
      body: { phone: '9876543210' },
    });
    const second = await invokeLimiter(otpSendLimiter, {
      body: { phone: '9876543210' },
    });
    const third = await invokeLimiter(otpSendLimiter, {
      body: { phone: '9876543210' },
    });

    expect(first.next).toHaveBeenCalled();
    expect(second.next).toHaveBeenCalled();
    expect(third.res.statusCode).toBe(429);
    expect(third.res.body).toEqual({
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many OTP send requests. Please wait 1 minute',
      },
    });
  });

  it('keys operator reads by staff identity rather than only IP', async () => {
    const { operatorReadLimiter } = await import('../../src/middleware/rateLimiter');

    const first = await invokeLimiter(operatorReadLimiter, {
      method: 'GET',
      path: '/tables',
      staff: { id: 'staff_1', venueId: 'venue_1' },
    });
    const second = await invokeLimiter(operatorReadLimiter, {
      method: 'GET',
      path: '/tables',
      staff: { id: 'staff_2', venueId: 'venue_1' },
    });

    expect(first.next).toHaveBeenCalled();
    expect(second.next).toHaveBeenCalled();
    expect(first.res.statusCode).toBe(200);
    expect(second.res.statusCode).toBe(200);
  });
});
