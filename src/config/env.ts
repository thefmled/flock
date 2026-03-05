import dotenv from 'dotenv';
dotenv.config();

const nodeEnv = process.env.NODE_ENV ?? 'development';
const defaultProdOrigins = 'https://app.flock.in,https://flock.in';

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optional(key: string, fallback = ''): string {
  return process.env[key] ?? fallback;
}

export const env = {
  NODE_ENV:   optional('NODE_ENV', nodeEnv),
  PORT:       parseInt(optional('PORT', '3000'), 10),
  API_VERSION: optional('API_VERSION', 'v1'),
  APP_ALLOWED_ORIGINS: optional('APP_ALLOWED_ORIGINS', nodeEnv === 'production' ? defaultProdOrigins : '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

  DATABASE_URL: required('DATABASE_URL'),
  REDIS_URL:    optional('REDIS_URL'),

  JWT_SECRET:     required('JWT_SECRET'),
  JWT_EXPIRES_IN: optional('JWT_EXPIRES_IN', '7d'),
  GUEST_JWT_EXPIRES_IN: optional('GUEST_JWT_EXPIRES_IN', '6h'),
  ONBOARDING_TOKEN: optional('ONBOARDING_TOKEN'),
  OTP_EXPIRES_SECONDS: parseInt(optional('OTP_EXPIRES_SECONDS', '300'), 10),
  EXPOSE_MOCK_OTP_IN_API: optional('EXPOSE_MOCK_OTP_IN_API', 'false') === 'true',

  RAZORPAY_KEY_ID:       optional('RAZORPAY_KEY_ID'),
  RAZORPAY_KEY_SECRET:   optional('RAZORPAY_KEY_SECRET'),
  RAZORPAY_WEBHOOK_SECRET: optional('RAZORPAY_WEBHOOK_SECRET'),

  GUPSHUP_API_KEY:       optional('GUPSHUP_API_KEY'),
  GUPSHUP_APP_NAME:      optional('GUPSHUP_APP_NAME', 'FlockApp'),
  GUPSHUP_SOURCE_NUMBER: optional('GUPSHUP_SOURCE_NUMBER'),

  MSG91_AUTH_KEY:          optional('MSG91_AUTH_KEY'),
  MSG91_SENDER_ID:         optional('MSG91_SENDER_ID', 'FLOCK'),
  MSG91_TEMPLATE_ID_OTP:   optional('MSG91_TEMPLATE_ID_OTP'),

  CLEARTAX_API_KEY:  optional('CLEARTAX_API_KEY'),
  CLEARTAX_BASE_URL: optional('CLEARTAX_BASE_URL', 'https://api.cleartax.in/v1'),

  URBANPIPER_USERNAME: optional('URBANPIPER_USERNAME'),
  URBANPIPER_API_KEY:  optional('URBANPIPER_API_KEY'),
  URBANPIPER_BASE_URL: optional('URBANPIPER_BASE_URL', 'https://api.urbanpiper.com/v1'),

  // Feature flags — default to mock in dev
  USE_MOCK_PAYMENTS:      optional('USE_MOCK_PAYMENTS', 'true') === 'true',
  USE_MOCK_NOTIFICATIONS: optional('USE_MOCK_NOTIFICATIONS', 'true') === 'true',
  USE_MOCK_GST:           optional('USE_MOCK_GST', 'true') === 'true',
  USE_MOCK_POS:           optional('USE_MOCK_POS', 'true') === 'true',

  TMS_POLL_INTERVAL_MS:       parseInt(optional('TMS_POLL_INTERVAL_MS', '4000'), 10),
  TABLE_READY_WINDOW_MINUTES: parseInt(optional('TABLE_READY_WINDOW_MINUTES', '10'), 10),

  isProd: () => process.env.NODE_ENV === 'production',
  isDev:  () => process.env.NODE_ENV !== 'production',
};
