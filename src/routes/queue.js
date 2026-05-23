const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function generateId() {
  return 'c' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

function calculateWaitTime(venue, position) {
  const { waitTimeBase, waitTimeIncrement, waitTimeCap } = venue;
  return Math.min(waitTimeBase + waitTimeIncrement * (position - 1), waitTimeCap);
}

// Add a guest to the queue (public — guest scans QR)
router.post('/join/:slug', async (req, res) => {
  try {
    const { guestName, guestPhone, partySize } = req.body;
    // Validate phone (Indian 10-digit starting 6-9)
    const phoneClean = (guestPhone || '').replace(/\D/g, '');
    if (!/^[6-9]\d{9}$/.test(phoneClean)) {
      return res.status(400).json({ error: 'Please enter a valid 10-digit Indian phone number.' });
    }
    if (!guestName || !guestPhone || !partySize) {
      return res.status(400).json({ error: 'Name, phone, and party size required' });
    }

    const venue = await prisma.venue.findUnique({ where: { slug: req.params.slug } });
    if (!venue) return res.status(404).json({ error: 'Venue not found' });

    const { seatingPreference, notes } = req.body;
    
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
      },
    });

    // Calculate guest's position
    const waitingAhead = await prisma.queueEntry.count({
      where: {
        venueId: venue.id,
        status: 'waiting',
        joinedAt: { lt: entry.joinedAt },
      },
    });
    const position = waitingAhead + 1;
    const waitMinutes = calculateWaitTime(venue, position);

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

    const enriched = entries.map((entry, idx) => ({
      ...entry,
      position: idx + 1,
      waitMinutes: calculateWaitTime(venue, idx + 1),
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

    const waitingAhead = await prisma.queueEntry.count({
      where: {
        venueId: entry.venueId,
        status: 'waiting',
        joinedAt: { lt: entry.joinedAt },
      },
    });
    const position = waitingAhead + 1;
    const waitMinutes = calculateWaitTime(entry.venue, position);

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

module.exports = router;
