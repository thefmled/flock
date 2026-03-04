import { Router } from 'express';
import authRoutes    from './auth.routes';
import venueRoutes   from './venue.routes';
import queueRoutes   from './queue.routes';
import tableRoutes   from './table.routes';
import menuRoutes    from './menu.routes';
import orderRoutes   from './order.routes';
import paymentRoutes from './payment.routes';
import partySessionRoutes from './partySession.routes';
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

router.get('/share/qr', async (req, res) => {
  const data = typeof req.query.data === 'string' ? req.query.data.trim() : '';
  const sizeRaw = Number.parseInt(String(req.query.size ?? '240'), 10);
  const size = Number.isFinite(sizeRaw) ? Math.min(600, Math.max(120, sizeRaw)) : 240;

  if (!data) {
    res.status(400).json({
      error: 'QR data is required.',
    });
    return;
  }

  try {
    const upstreamUrl = new URL('https://api.qrserver.com/v1/create-qr-code/');
    upstreamUrl.searchParams.set('size', `${size}x${size}`);
    upstreamUrl.searchParams.set('data', data);

    const upstream = await fetch(upstreamUrl);
    if (!upstream.ok) {
      res.status(502).json({
        error: 'QR service unavailable.',
      });
      return;
    }

    const contentType = upstream.headers.get('content-type') || 'image/png';
    const buffer = Buffer.from(await upstream.arrayBuffer());

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.status(200).send(buffer);
  } catch {
    res.status(502).json({
      error: 'QR service unavailable.',
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
router.use('/party-sessions', partySessionRoutes);

export default router;
