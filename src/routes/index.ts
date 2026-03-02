import { Router } from 'express';
import authRoutes    from './auth.routes';
import venueRoutes   from './venue.routes';
import queueRoutes   from './queue.routes';
import tableRoutes   from './table.routes';
import menuRoutes    from './menu.routes';
import orderRoutes   from './order.routes';
import paymentRoutes from './payment.routes';
import { prisma } from '../config/database';
import { isRedisReady } from '../config/redis';

const router = Router();

router.get('/health', async (_req, res) => {
  const redis = isRedisReady() ? 'ok' : 'degraded';

  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({
      status: redis === 'ok' ? 'ok' : 'degraded',
      service: 'flock-api',
      db: 'ok',
      redis,
      ts: new Date().toISOString(),
    });
  } catch {
    res.status(503).json({
      status: 'down',
      service: 'flock-api',
      db: 'down',
      redis,
      ts: new Date().toISOString(),
    });
  }
});

router.use('/auth',     authRoutes);
router.use('/venues',   venueRoutes);
router.use('/queue',    queueRoutes);
router.use('/tables',   tableRoutes);
router.use('/menu',     menuRoutes);
router.use('/orders',   orderRoutes);
router.use('/payments', paymentRoutes);

export default router;
