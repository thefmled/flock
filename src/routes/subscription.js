const express = require('express');
const Razorpay = require('razorpay');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Create a subscription with 14-day trial
router.post('/create', requireAuth, async (req, res) => {
  try {
    const owner = await prisma.owner.findUnique({ where: { id: req.ownerId } });
    if (!owner) return res.status(404).json({ error: 'Owner not found' });

    if (owner.razorpaySubscriptionId) {
      return res.json({ subscriptionId: owner.razorpaySubscriptionId, alreadyExists: true });
    }

    // Razorpay subscriptions accept start_at as unix timestamp in seconds
    const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    const subscription = await razorpay.subscriptions.create({
      plan_id: process.env.RAZORPAY_PLAN_ID,
      customer_notify: 1,
      total_count: 120, // 10 years of monthly billing
      start_at: Math.floor(trialEndsAt.getTime() / 1000),
      notes: {
        ownerId: owner.id,
        email: owner.phone, // 'phone' field holds email in our schema
      },
    });

    await prisma.owner.update({
      where: { id: owner.id },
      data: {
        razorpaySubscriptionId: subscription.id,
        subscriptionStatus: 'trial',
        trialEndsAt,
      },
    });

    res.json({
      subscriptionId: subscription.id,
      shortUrl: subscription.short_url,
      keyId: process.env.RAZORPAY_KEY_ID,
    });
  } catch (error) {
    console.error('Subscription create error:', error);
    res.status(500).json({ error: 'Failed to create subscription' });
  }
});

// Get current subscription status
router.get('/status', requireAuth, async (req, res) => {
  try {
    const owner = await prisma.owner.findUnique({ where: { id: req.ownerId } });
    if (!owner) return res.status(404).json({ error: 'Owner not found' });

    res.json({
      status: owner.subscriptionStatus,
      trialEndsAt: owner.trialEndsAt,
      subscriptionStartedAt: owner.subscriptionStartedAt,
      hasSubscription: !!owner.razorpaySubscriptionId,
    });
  } catch (error) {
    console.error('Subscription status error:', error);
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

// Razorpay webhook to handle subscription events
router.post('/webhook', express.json(), async (req, res) => {
  try {
    const event = req.body.event;
    const payload = req.body.payload;
    if (!event || !payload) return res.status(400).json({ error: 'Invalid webhook' });

    if (event === 'subscription.activated' || event === 'subscription.charged') {
      const subscriptionId = payload.subscription.entity.id;
      const owner = await prisma.owner.findFirst({
        where: { razorpaySubscriptionId: subscriptionId },
      });
      if (owner) {
        await prisma.owner.update({
          where: { id: owner.id },
          data: {
            subscriptionStatus: 'active',
            subscriptionStartedAt: owner.subscriptionStartedAt || new Date(),
          },
        });
      }
    } else if (event === 'subscription.cancelled' || event === 'subscription.completed') {
      const subscriptionId = payload.subscription.entity.id;
      const owner = await prisma.owner.findFirst({
        where: { razorpaySubscriptionId: subscriptionId },
      });
      if (owner) {
        await prisma.owner.update({
          where: { id: owner.id },
          data: { subscriptionStatus: 'cancelled' },
        });
      }
    } else if (event === 'subscription.paused' || event === 'subscription.halted') {
      const subscriptionId = payload.subscription.entity.id;
      const owner = await prisma.owner.findFirst({
        where: { razorpaySubscriptionId: subscriptionId },
      });
      if (owner) {
        await prisma.owner.update({
          where: { id: owner.id },
          data: { subscriptionStatus: 'paused' },
        });
      }
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Webhook handling failed' });
  }
});

module.exports = router;
