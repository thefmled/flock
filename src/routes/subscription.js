const express = require('express');
const Razorpay = require('razorpay');
const prisma = require('../lib/prisma');
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Create a subscription with 14-day trial — starts at quantity 1
router.post('/create', requireAuth, async (req, res) => {
  try {
    const owner = await prisma.owner.findUnique({ where: { id: req.ownerId } });
    if (!owner) return res.status(404).json({ error: 'Owner not found' });

    // If owner already has an active/trial subscription, return it. If cancelled/expired, allow creating a new one.
    if (owner.razorpaySubscriptionId && (owner.subscriptionStatus === 'active' || owner.subscriptionStatus === 'trial')) {
      return res.json({ subscriptionId: owner.razorpaySubscriptionId, alreadyExists: true });
    }

    const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    const subscription = await razorpay.subscriptions.create({
      plan_id: process.env.RAZORPAY_PLAN_ID,
      customer_notify: 1,
      quantity: 1,
      total_count: 120,
      start_at: Math.floor(trialEndsAt.getTime() / 1000),
      notes: {
        ownerId: owner.id,
        email: owner.phone,
      },
    });

    await prisma.owner.update({
      where: { id: owner.id },
      data: {
        razorpaySubscriptionId: subscription.id,
        subscriptionStatus: 'trial',
        trialEndsAt,
        venueQuantity: 1,
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
      venueQuantity: owner.venueQuantity,
      monthlyAmount: owner.venueQuantity * 999,
    });
  } catch (error) {
    console.error('Subscription status error:', error);
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

// Update subscription quantity (called when venues are added/removed)
async function updateSubscriptionQuantity(ownerId, newQuantity) {
  const owner = await prisma.owner.findUnique({ where: { id: ownerId } });
  if (!owner || !owner.razorpaySubscriptionId) return;

  // Update local count regardless
  await prisma.owner.update({
    where: { id: ownerId },
    data: { venueQuantity: newQuantity },
  });

  // Only sync with Razorpay if subscription is active
  if (owner.subscriptionStatus === 'active') {
    try {
      await razorpay.subscriptions.update(owner.razorpaySubscriptionId, {
        quantity: newQuantity,
        schedule_change_at: 'cycle_end',
      });
      // Clear sync flag on success
      await prisma.owner.update({
        where: { id: ownerId },
        data: { needsSubscriptionSync: false },
      });
    } catch (e) {
      console.error('Razorpay quantity update failed:', e.message || e);
      // Mark for retry
      await prisma.owner.update({
        where: { id: ownerId },
        data: { needsSubscriptionSync: true },
      });
    }
  }
}

// Periodic retry — runs every 10 minutes
async function retryFailedSyncs() {
  try {
    const owners = await prisma.owner.findMany({
      where: { needsSubscriptionSync: true, subscriptionStatus: 'active' },
    });
    for (const owner of owners) {
      const venueCount = await prisma.venue.count({ where: { ownerId: owner.id } });
      await updateSubscriptionQuantity(owner.id, venueCount);
    }
  } catch (e) {
    console.error('Retry failed syncs error:', e);
  }
}

// Kick off retry interval at module load
setInterval(retryFailedSyncs, 10 * 60 * 1000);

// Mark expired trials — runs every hour
async function expireOldTrials() {
  try {
    const graceMs = 3 * 24 * 60 * 60 * 1000;
    const cutoff = new Date(Date.now() - graceMs);
    const owners = await prisma.owner.findMany({
      where: {
        subscriptionStatus: 'trial',
        trialEndsAt: { lt: cutoff },
      },
    });
    for (const owner of owners) {
      await prisma.owner.update({
        where: { id: owner.id },
        data: { subscriptionStatus: 'expired' },
      });
      console.log(`Trial expired for owner ${owner.id}`);
    }
  } catch (e) {
    console.error('Expire trials error:', e);
  }
}

setInterval(expireOldTrials, 60 * 60 * 1000);

// Razorpay webhook to handle subscription events
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    // Verify signature — fail closed
    const signature = req.headers['x-razorpay-signature'];
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) {
      console.error('RAZORPAY_WEBHOOK_SECRET not configured — rejecting webhook');
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }
    if (!signature) {
      console.warn('Webhook missing signature header');
      return res.status(400).json({ error: 'Missing signature' });
    }
    const expected = crypto.createHmac('sha256', secret).update(req.body).digest('hex');
    if (expected !== signature) {
      console.warn('Webhook signature mismatch');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const body = JSON.parse(req.body.toString());
    const event = body.event;
    const payload = body.payload;
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

        // Sync the current venue count to Razorpay now that the subscription is active
        const venueCount = await prisma.venue.count({ where: { ownerId: owner.id } });
        if (venueCount !== owner.venueQuantity) {
          await updateSubscriptionQuantity(owner.id, venueCount);
        }
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

// Cancel subscription at end of current cycle
router.post('/cancel', requireAuth, async (req, res) => {
  try {
    const owner = await prisma.owner.findUnique({ where: { id: req.ownerId } });
    if (!owner) return res.status(404).json({ error: 'Owner not found' });
    if (!owner.razorpaySubscriptionId) return res.status(400).json({ error: 'No active subscription' });

    try {
      // Razorpay flag: `true` = cancel immediately, `false` = cancel at end of current billing cycle.
      // We want end-of-cycle so the user keeps access until their paid period ends.
      const cancelImmediately = false;
      await razorpay.subscriptions.cancel(owner.razorpaySubscriptionId, cancelImmediately);
    } catch (e) {
      console.error('Razorpay cancel failed:', e.message || e);
      // Continue anyway — mark cancelled locally
    }

    await prisma.owner.update({
      where: { id: owner.id },
      data: { subscriptionStatus: 'cancelled' },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Subscription cancel error:', error);
    res.status(500).json({ error: 'Failed to cancel' });
  }
});

module.exports = router;
module.exports.updateSubscriptionQuantity = updateSubscriptionQuantity;
