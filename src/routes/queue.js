const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function generateId() {
  return 'c' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

async function computeWaitTimes(entries, venue) {
  const waitTimes = [];

  for (let idx = 0; idx < entries.length; idx++) {
    const entry = entries[idx];
    const inc = entry.waitTimeIncrementAtJoin ?? venue.waitTimeIncrement;
    const cap = entry.waitTimeCapAtJoin ?? venue.waitTimeCap;

    let wait;
    if (idx === 0) {
      // First time hitting position #1: re-anchor base to current venue base
      if (!entry.hasBeenPositionOne) {
        await prisma.queueEntry.update({
          where: { id: entry.id },
          data: {
            waitTimeBaseAtJoin: venue.waitTimeBase,
            hasBeenPositionOne: true,
          },
        });
        entry.waitTimeBaseAtJoin = venue.waitTimeBase;
        entry.hasBeenPositionOne = true;
      }

      const baseSnap = entry.waitTimeBaseAtJoin;
      const newBase = Math.min(baseSnap, venue.waitTimeBase);
      // Persist if it dropped
      if (newBase < baseSnap) {
        await prisma.queueEntry.update({
          where: { id: entry.id },
          data: { waitTimeBaseAtJoin: newBase },
        });
        entry.waitTimeBaseAtJoin = newBase;
      }
      wait = newBase;
    } else {
      wait = waitTimes[idx - 1] + inc;
    }
    wait = Math.min(wait, cap);
    waitTimes.push(wait);
  }

  return waitTimes;
}

// Add a guest to the queue (public — guest scans QR)
router.post('/join/:slug', async (req, res) => {
  try {
    const { guestName, guestPhone, partySize, seatingPreference, notes } = req.body;
    if (!guestName || !guestPhone || !partySize) {
      return res.status(400).json({ error: 'Name, phone, and party size required' });
    }

    // Validate phone (Indian 10-digit starting 6-9)
    const phoneClean = (guestPhone || '').replace(/\D/g, '');
    if (!/^[6-9]\d{9}$/.test(phoneClean)) {
      return res.status(400).json({ error: 'Please enter a valid 10-digit Indian phone number.' });
    }

    const venue = await prisma.venue.findUnique({ where: { slug: req.params.slug } });
    if (!venue) return res.status(404).json({ error: 'Venue not found' });

    // Check for existing waiting entry from same phone
    const existing = await prisma.queueEntry.findFirst({
      where: {
        venueId: venue.id,
        guestPhone: phoneClean,
        status: 'waiting',
      },
    });
    if (existing) {
      return res.json({ success: true, entry: existing, alreadyInQueue: true });
    }

    const entry = await prisma.queueEntry.create({
      data: {
        id: generateId(),
        venueId: venue.id,
        guestName,
        guestPhone: phoneClean,
        partySize: parseInt(partySize),
        seatingPreference: seatingPreference || null,
        notes: notes || null,
        status: 'waiting',
        waitTimeBaseAtJoin: venue.waitTimeBase,
        waitTimeIncrementAtJoin: venue.waitTimeIncrement,
        waitTimeCapAtJoin: venue.waitTimeCap,
      },
    });

    // Calculate guest's position
    const allWaiting = await prisma.queueEntry.findMany({
      where: { venueId: venue.id, status: 'waiting' },
      orderBy: { joinedAt: 'asc' },
    });
    const position = allWaiting.findIndex(e => e.id === entry.id) + 1;
    const waitMinutes = (await computeWaitTimes(allWaiting, venue))[position - 1];

    res.json({ success: true, entry, position, waitMinutes });
  } catch (error) {
    console.error('Join queue error:', error);
    res.status(500).json({ error: 'Failed to join queue' });
  }
});

// Get live queue (authed — staff view)
router.get('/live/:venueId', requireAuth, async (req, res) => {
  try {
    const venue = await prisma.venue.findFirst({
      where: { id: req.params.venueId, ownerId: req.ownerId },
    });
    if (!venue) return res.status(404).json({ error: 'Venue not found' });

    const entries = await prisma.queueEntry.findMany({
      where: { venueId: venue.id, status: 'waiting' },
      orderBy: { joinedAt: 'asc' },
    });

    const waitTimes = await computeWaitTimes(entries, venue);
    const enriched = entries.map((entry, idx) => ({
      ...entry,
      position: idx + 1,
      waitMinutes: waitTimes[idx],
    }));

    res.json({ entries: enriched });
  } catch (error) {
    console.error('Live queue error:', error);
    res.status(500).json({ error: 'Failed to fetch queue' });
  }
});

// Get guest status (public — guest checks position)
router.get('/status/:entryId', async (req, res) => {
  try {
    const entry = await prisma.queueEntry.findUnique({
      where: { id: req.params.entryId },
      include: { venue: true },
    });
    if (!entry) return res.status(404).json({ error: 'Entry not found' });

    const allWaiting = await prisma.queueEntry.findMany({
      where: { venueId: entry.venueId, status: 'waiting' },
      orderBy: { joinedAt: 'asc' },
      include: { venue: false },
    });
    const position = allWaiting.findIndex(e => e.id === entry.id) + 1;
    const waitMinutes = position > 0
      ? (await computeWaitTimes(allWaiting, entry.venue))[position - 1]
      : 0;

    res.json({ entry, position, waitMinutes });
  } catch (error) {
    console.error('Status error:', error);
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

// Notify guest (authed)
router.post('/notify/:entryId', requireAuth, async (req, res) => {
  try {
    const entry = await prisma.queueEntry.findUnique({
      where: { id: req.params.entryId },
      include: { venue: true },
    });
    if (!entry) return res.status(404).json({ error: 'Entry not found' });
    if (entry.venue.ownerId !== req.ownerId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await prisma.queueEntry.update({
      where: { id: entry.id },
      data: { notifiedAt: new Date(), status: 'notified' },
    });

    // TODO: trigger WhatsApp via Gupshup (we'll add this next)

    res.json({ success: true });
  } catch (error) {
    console.error('Notify error:', error);
    res.status(500).json({ error: 'Failed to notify' });
  }
});

// Mark as seated (authed)
router.post('/seat/:entryId', requireAuth, async (req, res) => {
  try {
    const entry = await prisma.queueEntry.findUnique({
      where: { id: req.params.entryId },
      include: { venue: true },
    });
    if (!entry) return res.status(404).json({ error: 'Entry not found' });
    if (entry.venue.ownerId !== req.ownerId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await prisma.queueEntry.update({
      where: { id: entry.id },
      data: { seatedAt: new Date(), status: 'seated' },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Seat error:', error);
    res.status(500).json({ error: 'Failed to seat guest' });
  }
});

// Cancel entry (public — guest can self-cancel, also authed for staff)
router.post('/cancel/:entryId', async (req, res) => {
  try {
    await prisma.queueEntry.update({
      where: { id: req.params.entryId },
      data: { cancelledAt: new Date(), status: 'cancelled' },
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Cancel error:', error);
    res.status(500).json({ error: 'Failed to cancel' });
  }
});

// Get queue history (today's entries — all statuses)
router.get('/history/:venueId', requireAuth, async (req, res) => {
  try {
    const venue = await prisma.venue.findFirst({
      where: { id: req.params.venueId, ownerId: req.ownerId },
    });
    if (!venue) return res.status(404).json({ error: 'Venue not found' });

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const entries = await prisma.queueEntry.findMany({
      where: { venueId: venue.id, joinedAt: { gte: startOfDay } },
      orderBy: { joinedAt: 'desc' },
    });

    res.json({ entries });
  } catch (error) {
    console.error('History error:', error);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

module.exports = router;
