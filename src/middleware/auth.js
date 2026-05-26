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
async function requireActiveSubscription(req, res, next) {
  try {
    const owner = await prisma.owner.findUnique({ where: { id: req.ownerId } });
    if (!owner) return res.status(404).json({ error: 'Owner not found' });

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
      return res.status(402).json({ error: 'Trial expired', requiresSubscription: true });
    }

    return res.status(402).json({ error: 'Subscription required', requiresSubscription: true });
  } catch (error) {
    console.error('Subscription check error:', error);
    return res.status(500).json({ error: 'Failed to verify subscription' });
  }
}

module.exports = { requireAuth, requireActiveSubscription };
