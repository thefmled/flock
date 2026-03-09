import { webcrypto } from 'node:crypto';

process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://flock:password@localhost:5432/flock_test?schema=public';
process.env.JWT_SECRET ??= 'test-jwt-secret';
process.env.JWT_EXPIRES_IN ??= '7d';
process.env.GUEST_JWT_EXPIRES_IN ??= '6h';
process.env.ONBOARDING_TOKEN ??= 'test-onboarding-token';
process.env.EXPOSE_MOCK_OTP_IN_API ??= 'true';
process.env.USE_MOCK_PAYMENTS ??= 'true';
process.env.USE_MOCK_NOTIFICATIONS ??= 'true';
process.env.USE_MOCK_GST ??= 'true';
process.env.USE_MOCK_POS ??= 'true';
process.env.DISABLE_TMS_POLLER ??= 'true';
process.env.RATE_LIMIT_STRATEGY_VERSION ??= '2';
process.env.RATE_LIMIT_OPERATOR_READ_MAX ??= '6';
process.env.RATE_LIMIT_OPERATOR_WRITE_MAX ??= '4';
process.env.RATE_LIMIT_GUEST_POLL_MAX ??= '8';
process.env.RATE_LIMIT_OTP_SEND_MAX ??= '2';
process.env.RATE_LIMIT_OTP_VERIFY_MAX ??= '2';

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
  });
}
