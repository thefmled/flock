import 'dotenv/config';
import app from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { connectDatabase, disconnectDatabase } from './config/database';
import { closeRedis, connectRedis } from './config/redis';
import { startTmsPoller } from './workers/tmsPoller';

export async function bootstrap(): Promise<void> {
  if (env.isProd() && (env.USE_MOCK_PAYMENTS || env.USE_MOCK_NOTIFICATIONS || env.USE_MOCK_GST)) {
    logger.warn(
      '⚠️  PILOT MODE: Mock integrations are enabled in production. ' +
      'Set USE_MOCK_PAYMENTS, USE_MOCK_NOTIFICATIONS, USE_MOCK_GST to false before going live.',
    );
  }

  // Connect to infrastructure
  await connectDatabase();
  await connectRedis();

  // Start background workers
  const tmsPoller = env.DISABLE_TMS_POLLER || env.isTest()
    ? null
    : startTmsPoller();

  // Start HTTP server
  const server = app.listen(env.PORT, () => {
    logger.info(`🐦 Flock API running on port ${env.PORT} [${env.NODE_ENV}]`);
    logger.info(`   Mocks: payments=${env.USE_MOCK_PAYMENTS} notifications=${env.USE_MOCK_NOTIFICATIONS} gst=${env.USE_MOCK_GST} pos=${env.USE_MOCK_POS}`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`${signal} received — shutting down gracefully`);
    if (tmsPoller) {
      clearInterval(tmsPoller);
    }
    server.close(async () => {
      await disconnectDatabase();
      await closeRedis();
      logger.info('Flock API shut down cleanly');
      process.exit(0);
    });
    setTimeout(() => { logger.error('Forced shutdown after timeout'); process.exit(1); }, 10_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

if (require.main === module) {
  bootstrap().catch((err) => {
    console.error('Bootstrap failed:', err);
    process.exit(1);
  });
}
