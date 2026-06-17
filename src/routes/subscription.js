const express = require('express');
const Razorpay = require('razorpay');
const prisma = require('../lib/prisma');
const crypto = require('crypto');
const { notifyOps } = require('../lib/notify-ops');
const { requireAuth, invalidateSubCache } = require('../middleware/auth');

const router = express.Router();

// Single source of truth for the per-venue monthly price (INR). Change it here and it
// propagates to the /status amount, the public /pricing endpoint, and every page that reads
// those (subscribe, main, and the marketing/legal pages via pricing.js).
const MONTHLY_PRICE_INR = 999;

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Create a subscription with 14-day trial, starts at quantity 1
router.post('/create', requireAuth, async (req, res) => {
  try {
    const owner = await prisma.owner.findUnique({ where: { id: req.ownerId } });
    if (!owner) return res.status(404).json({ error: 'Owner not found' });

    // Active subscription, or trial that's still running, treat as already-exists.
    const trialStillValid = owner.subscriptionStatus === 'trial' && owner.trialEndsAt && new Date(owner.trialEndsAt) > new Date();
    if (owner.razorpaySubscriptionId && (owner.subscriptionStatus === 'active' || trialStillValid)) {
      return res.json({ subscriptionId: owner.razorpaySubscriptionId, alreadyExists: true });
    }
    // Grace period (trial expired but within 24h) OR pending payment, let them resume checkout
    // on the same Razorpay subscription rather than creating a new orphan.
    if (owner.razorpaySubscriptionId && (owner.subscriptionStatus === 'pending' || owner.subscriptionStatus === 'trial')) {
      return res.json({
        subscriptionId: owner.razorpaySubscriptionId,
        keyId: process.env.RAZORPAY_KEY_ID,
        isReturning: true,
        isResume: true,
      });
    }

    // Has the owner already used a trial? If so, no second free trial.
    // We detect this by the presence of a prior razorpaySubscriptionId OR a past trialEndsAt.
    const hasHadTrial = !!owner.razorpaySubscriptionId || !!owner.trialEndsAt;
    const venueCount = await prisma.venue.count({ where: { ownerId: owner.id } });
    const initialQuantity = Math.max(1, venueCount); // preserve current venue count

    const subParams = {
      plan_id: process.env.RAZORPAY_PLAN_ID,
      customer_notify: 1,
      quantity: initialQuantity,
      total_count: 120,
      notes: {
        ownerId: owner.id,
        email: owner.email,
      },
    };
    let trialEndsAt = null;
    if (!hasHadTrial) {
      // First-time user gets a 14-day trial
      trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      subParams.start_at = Math.floor(trialEndsAt.getTime() / 1000);
    }
    // Returning user: omit start_at, Razorpay starts billing immediately

    const subscription = await razorpay.subscriptions.create(subParams);

    await prisma.owner.update({
      where: { id: owner.id },
      data: {
        razorpaySubscriptionId: subscription.id,
        subscriptionStatus: hasHadTrial ? 'pending' : 'trial',
        trialEndsAt: trialEndsAt || owner.trialEndsAt, // preserve original trial date for record
        venueQuantity: initialQuantity,
      },
    });
    invalidateSubCache(owner.id);

    res.json({
      subscriptionId: subscription.id,
      shortUrl: subscription.short_url,
      keyId: process.env.RAZORPAY_KEY_ID,
      isReturning: hasHadTrial,
    });
  } catch (error) {
    console.error('Subscription create error:', error);
    res.status(500).json({ error: 'Failed to create subscription' });
  }
});

// Get current subscription status (lazy-reconciles 'pending' state with Razorpay)
// Background reconcile guard, prevents duplicate concurrent Razorpay fetches per owner
const reconcileInFlight = new Set();
// Throttle for reconciling *active* owners so we don't hit Razorpay on every /status poll
const activeReconcileAt = new Map(); // ownerId -> last active-reconcile timestamp
const ACTIVE_RECONCILE_THROTTLE_MS = 6 * 60 * 60 * 1000; // 6h

// Reconcile local status against Razorpay (a fallback for missed webhooks). Runs OFF the
// request path so /status stays fast; the next poll reflects any change it makes.
// Mirrors Razorpay's authoritative state, matching the webhook handler's mappings.
async function reconcileFromRazorpay(ownerId, razorpaySubscriptionId, subscriptionStartedAt) {
  if (reconcileInFlight.has(ownerId)) return;
  reconcileInFlight.add(ownerId);
  try {
    const rzSub = await razorpay.subscriptions.fetch(razorpaySubscriptionId);
    // Razorpay statuses: created, authenticated, active, pending, halted, cancelled, completed, expired
    let newStatus = null;
    if (rzSub.status === 'active' || rzSub.status === 'authenticated') newStatus = 'active';
    else if (rzSub.status === 'cancelled') newStatus = 'cancelled';                            // access until cycle end
    else if (rzSub.status === 'completed' || rzSub.status === 'expired') newStatus = 'expired'; // fully ended → block
    else if (rzSub.status === 'halted' || rzSub.status === 'paused') newStatus = 'paused';      // payment issue → block + recovery UI
    if (!newStatus) return; // created/pending, nothing settled yet

    const data = { subscriptionStatus: newStatus };
    if (newStatus === 'active') data.subscriptionStartedAt = subscriptionStartedAt || new Date();
    if (newStatus === 'cancelled') {
      // Capture the cycle-end so the expiry cron (#19/#23) can eventually expire them
      const endUnix = rzSub.current_end || rzSub.end_at;
      if (endUnix) data.subscriptionEndsAt = new Date(endUnix * 1000);
    }
    await prisma.owner.update({ where: { id: ownerId }, data });
    invalidateSubCache(ownerId);
  } catch (e) {
    console.error('Razorpay reconcile fetch failed:', e.message || e);
  } finally {
    reconcileInFlight.delete(ownerId);
  }
}

router.get('/status', requireAuth, async (req, res) => {
  try {
    const owner = await prisma.owner.findUnique({ where: { id: req.ownerId } });
    if (!owner) return res.status(404).json({ error: 'Owner not found' });

    // Background reconcile against Razorpay (fallback for missed webhooks), never blocks
    // the response; the next poll reflects any change.
    //  - pending / trial-in-grace: catch a subscription that activated but whose webhook was missed
    //  - active: catch one that was cancelled/ended on Razorpay but whose webhook was missed
    //    (otherwise the user keeps access forever). Throttled so we don't poll Razorpay constantly.
    const trialInGrace = owner.subscriptionStatus === 'trial' && owner.trialEndsAt && new Date(owner.trialEndsAt) < new Date();
    const staleReconcile = (owner.subscriptionStatus === 'pending' || trialInGrace) && owner.razorpaySubscriptionId;
    const activeReconcile = owner.subscriptionStatus === 'active' && owner.razorpaySubscriptionId
      && (Date.now() - (activeReconcileAt.get(owner.id) || 0) > ACTIVE_RECONCILE_THROTTLE_MS);
    if (staleReconcile || activeReconcile) {
      if (activeReconcile) activeReconcileAt.set(owner.id, Date.now());
      reconcileFromRazorpay(owner.id, owner.razorpaySubscriptionId, owner.subscriptionStartedAt);
    }

    res.json({
      status: owner.subscriptionStatus,
      trialEndsAt: owner.trialEndsAt,
      subscriptionStartedAt: owner.subscriptionStartedAt,
      subscriptionEndsAt: owner.subscriptionEndsAt,
      hasSubscription: !!owner.razorpaySubscriptionId,
      venueQuantity: owner.venueQuantity,
      monthlyPrice: MONTHLY_PRICE_INR,
      monthlyAmount: owner.venueQuantity * MONTHLY_PRICE_INR,
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

  if (owner.subscriptionStatus === 'active') {
    try {
      await razorpay.subscriptions.update(owner.razorpaySubscriptionId, {
        quantity: newQuantity,
        schedule_change_at: 'cycle_end',
      });
      await prisma.owner.update({
        where: { id: ownerId },
        data: { needsSubscriptionSync: false },
      });
    } catch (e) {
      console.error('Razorpay quantity update failed:', e.message || e);
      await prisma.owner.update({
        where: { id: ownerId },
        data: { needsSubscriptionSync: true },
      });
    }
  } else if (owner.subscriptionStatus === 'trial') {
    // Can't update Razorpay during trial (subscription not active yet).
    // Flag for sync, retry loop will catch it once status flips to active.
    await prisma.owner.update({
      where: { id: ownerId },
      data: { needsSubscriptionSync: true },
    });
  }
}

// Periodic retry, runs every 10 minutes
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

// Mark expired trials, runs every hour
async function expireOldTrials() {
  try {
    const graceMs = 24 * 60 * 60 * 1000; // matches middleware grace period
    const cutoff = new Date(Date.now() - graceMs);
    // 1) Trials that ran past their grace window
    const expiredTrials = await prisma.owner.findMany({
      where: {
        subscriptionStatus: 'trial',
        trialEndsAt: { lt: cutoff },
      },
    });
    // 2) Cancelled subscriptions whose paid period has ended, backstop in case the
    //    subscription.completed webhook was never delivered (otherwise these keep access forever)
    const expiredCancelled = await prisma.owner.findMany({
      where: {
        subscriptionStatus: 'cancelled',
        subscriptionEndsAt: { lt: new Date() },
      },
    });
    for (const owner of [...expiredTrials, ...expiredCancelled]) {
      await prisma.owner.update({
        where: { id: owner.id },
        data: { subscriptionStatus: 'expired' },
      });
      invalidateSubCache(owner.id);
      console.log(`Subscription expired for owner ${owner.id}`);
    }
  } catch (e) {
    console.error('Expire subscriptions error:', e);
  }
}

setInterval(expireOldTrials, 60 * 60 * 1000);

// Razorpay webhook to handle subscription events
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    // Verify signature, fail closed
    const signature = req.headers['x-razorpay-signature'];
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) {
      console.error('RAZORPAY_WEBHOOK_SECRET not configured, rejecting webhook');
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }
    if (!signature) {
      console.warn('Webhook missing signature header');
      return res.status(400).json({ error: 'Missing signature' });
    }
    const expected = crypto.createHmac('sha256', secret).update(req.body).digest('hex');
    const sigBuf = Buffer.from(String(signature), 'utf8');
    const expBuf = Buffer.from(expected, 'utf8');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      console.warn('Webhook signature mismatch');
      notifyOps('webhook_signature_mismatch', 'A Razorpay webhook failed signature verification, check RAZORPAY_WEBHOOK_SECRET matches the dashboard.', 'critical');
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
        invalidateSubCache(owner.id);

        // Sync the current venue count to Razorpay now that the subscription is active
        const venueCount = await prisma.venue.count({ where: { ownerId: owner.id } });
        if (venueCount !== owner.venueQuantity) {
          await updateSubscriptionQuantity(owner.id, venueCount);
        }
      }
    } else if (event === 'subscription.cancelled') {
      // User cancelled, but cycle is still running, middleware allows access until 'completed' fires
      const subscriptionId = payload.subscription.entity.id;
      const owner = await prisma.owner.findFirst({
        where: { razorpaySubscriptionId: subscriptionId },
      });
      if (owner) {
        await prisma.owner.update({
          where: { id: owner.id },
          data: { subscriptionStatus: 'cancelled' },
        });
        invalidateSubCache(owner.id);
      }
    } else if (event === 'subscription.completed') {
      // Subscription has truly ended, block access
      const subscriptionId = payload.subscription.entity.id;
      const owner = await prisma.owner.findFirst({
        where: { razorpaySubscriptionId: subscriptionId },
      });
      if (owner) {
        await prisma.owner.update({
          where: { id: owner.id },
          data: { subscriptionStatus: 'expired' },
        });
        invalidateSubCache(owner.id);
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
        invalidateSubCache(owner.id);
      }
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    notifyOps('webhook_handler_error', error && error.message ? error.message : String(error), 'critical');
    res.status(500).json({ error: 'Webhook handling failed' });
  }
});

// Cancel subscription at end of current cycle
router.post('/cancel', requireAuth, async (req, res) => {
  try {
    const owner = await prisma.owner.findUnique({ where: { id: req.ownerId } });
    if (!owner) return res.status(404).json({ error: 'Owner not found' });
    if (!owner.razorpaySubscriptionId) return res.status(400).json({ error: 'No active subscription' });

    let subscriptionEndsAt = null;
    try {
      // Razorpay's cancel(id, cancelAtCycleEnd): pass `true` to keep the subscription
      // active until the end of the current paid cycle (Razorpay then fires
      // subscription.completed at that point). Passing false / omitting cancels IMMEDIATELY.
      const result = await razorpay.subscriptions.cancel(owner.razorpaySubscriptionId, true);
      const endUnix = result && (result.current_end || result.end_at);
      if (endUnix) subscriptionEndsAt = new Date(endUnix * 1000);
    } catch (e) {
      console.error('Razorpay cancel failed:', e.message || e);
      // Do NOT mark cancelled locally, Razorpay still considers the subscription active
      // and would keep billing the customer. Surface the failure so the user can retry.
      return res.status(502).json({ error: 'Could not cancel with the payment provider. Please try again.' });
    }

    await prisma.owner.update({
      where: { id: owner.id },
      data: { subscriptionStatus: 'cancelled', subscriptionEndsAt },
    });
    invalidateSubCache(owner.id);

    res.json({ success: true });
  } catch (error) {
    console.error('Subscription cancel error:', error);
    res.status(500).json({ error: 'Failed to cancel' });
  }
});

// Public pricing, no auth, so marketing/legal pages can read the single-source price.
router.get('/pricing', (req, res) => {
  res.json({ monthlyPrice: MONTHLY_PRICE_INR });
});

module.exports = router;
module.exports.updateSubscriptionQuantity = updateSubscriptionQuantity;
