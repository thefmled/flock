const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.ownerId = decoded.ownerId;
    req.email = decoded.email;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Check subscription status — used on protected routes that require an active subscription
const subCache = new Map(); // ownerId -> { status, trialEndsAt, expiresAt }
const SUB_TTL_MS = 60 * 1000;

function invalidateSubCache(ownerId) { subCache.delete(ownerId); }

async function requireActiveSubscription(req, res, next) {
  try {
    let cached = subCache.get(req.ownerId);
    if (cached && cached.expiresAt > Date.now()) {
      const status = cached.status;
      if (status === 'active') return next();
      if (status === 'trial' && cached.trialEndsAt && new Date(cached.trialEndsAt) > new Date()) return next();
      // Fall through to DB on expired/cancelled to confirm before blocking
    }
    const owner = await prisma.owner.findUnique({ where: { id: req.ownerId } });
    if (!owner) return res.status(404).json({ error: 'Owner not found' });
    subCache.set(req.ownerId, {
      status: owner.subscriptionStatus,
      trialEndsAt: owner.trialEndsAt,
      expiresAt: Date.now() + SUB_TTL_MS,
    });

    const status = owner.subscriptionStatus;
    if (status === 'active') return next();

    if (status === 'trial') {
      if (owner.trialEndsAt && new Date(owner.trialEndsAt) > new Date()) {
        return next();
      }
      // Trial expired
      await prisma.owner.update({
        where: { id: owner.id },
        data: { subscriptionStatus: 'expired' },
      });
      invalidateSubCache(owner.id);
      return res.status(402).json({ error: 'Trial expired', requiresSubscription: true });
    }

    return res.status(402).json({ error: 'Subscription required', requiresSubscription: true });
  } catch (error) {
    console.error('Subscription check error:', error);
    return res.status(500).json({ error: 'Failed to verify subscription' });
  }
}

module.exports = { requireAuth, requireActiveSubscription, invalidateSubCache };
