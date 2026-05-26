const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth, requireActiveSubscription } = require('../middleware/auth');
const { sendTemplate } = require('../lib/whatsapp');

const router = express.Router();

function generateId() {
  return 'c' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

async function logAudit(queueEntryId, action, details = null) {
  try {
    await prisma.auditLog.create({
      data: {
        id: generateId(),
        queueEntryId,
        action,
        details,
      },
    });
  } catch (e) {
    console.error('Audit log error:', e);
  }
}

async function computeWaitTimes(entries, venue) {
  const waitTimes = [];
  const updates = [];

  for (let idx = 0; idx < entries.length; idx++) {
    const entry = entries[idx];
    const currentPos = idx + 1;
    const inc = entry.waitTimeIncrementAtJoin ?? venue.waitTimeIncrement;
    const cap = entry.waitTimeCapAtJoin ?? venue.waitTimeCap;

    const updateData = {};

    if (entry.lastPosition !== currentPos) {
      updateData.lastPosition = currentPos;
      updateData.positionEnteredAt = new Date();
      updateData.lockedWait = null;
      updateData.startingWait = null;
      entry.lastPosition = currentPos;
      entry.positionEnteredAt = new Date();
      entry.lockedWait = null;
      entry.startingWait = null;
    }

    let wait;
    if (idx === 0) {
      if (!entry.hasBeenPositionOne) {
        updateData.waitTimeBaseAtJoin = venue.waitTimeBase;
        updateData.hasBeenPositionOne = true;
        entry.waitTimeBaseAtJoin = venue.waitTimeBase;
        entry.hasBeenPositionOne = true;
      }
      const baseSnap = entry.waitTimeBaseAtJoin;
      const newBase = Math.min(baseSnap, venue.waitTimeBase);
      if (newBase < baseSnap) {
        updateData.waitTimeBaseAtJoin = newBase;
        entry.waitTimeBaseAtJoin = newBase;
      }
      wait = newBase;
    } else {
      const baseFloor = venue.waitTimeBase;
      const chainStart = waitTimes[idx - 1] + inc;

      if (entry.startingWait == null) {
        updateData.startingWait = chainStart;
        entry.startingWait = chainStart;
      }

      if (entry.lastBaseSeen != null && baseFloor < entry.lastBaseSeen && entry.lockedWait != null && entry.lockedWait > baseFloor) {
        updateData.positionEnteredAt = new Date();
        updateData.startingWait = entry.lockedWait;
        entry.positionEnteredAt = new Date();
        entry.startingWait = entry.lockedWait;
      }

      if (entry.lastBaseSeen !== baseFloor) {
        updateData.lastBaseSeen = baseFloor;
        entry.lastBaseSeen = baseFloor;
      }

      const enteredAt = entry.positionEnteredAt;
      const elapsedMinutes = enteredAt
        ? (Date.now() - new Date(enteredAt).getTime()) / 60000
        : 0;

      const tickedDown = Math.max(baseFloor, Math.ceil(entry.startingWait - elapsedMinutes));

      let computed;
      if (entry.lockedWait != null) {
        computed = Math.min(entry.lockedWait, tickedDown);
      } else {
        computed = tickedDown;
      }

      if (entry.lockedWait !== computed) {
        updateData.lockedWait = computed;
        entry.lockedWait = computed;
      }

      wait = computed;
    }
    wait = Math.min(wait, cap);
    waitTimes.push(wait);

    if (Object.keys(updateData).length > 0) {
      updates.push({ id: entry.id, data: updateData });
    }
  }

  // Batch update — fire all updates in parallel instead of awaiting each one
  if (updates.length > 0) {
    await Promise.all(updates.map(u =>
      prisma.queueEntry.update({ where: { id: u.id }, data: u.data })
    ));
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
        status: { in: ['waiting', 'notified'] },
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

    await logAudit(entry.id, 'joined', `Party of ${partySize}`);
    
    // Calculate guest's position
    const count = await prisma.queueEntry.count({
      where: { venueId: venue.id, status: { in: ['waiting', 'notified'] }, joinedAt: { lte: entry.joinedAt } },
    });
    const position = count;
    // Simple position-based estimate — full recalc happens on next dashboard poll
    const baseFloor = venue.waitTimeBase;
    const waitMinutes = Math.min(
      baseFloor + venue.waitTimeIncrement * (position - 1),
      venue.waitTimeCap
    );

    // Fire WhatsApp queue-joined message (non-blocking)
    const statusUrl = `${process.env.PUBLIC_URL || 'https://flock-wdz3.onrender.com'}/status.html?id=${entry.id}`;
    sendTemplate(phoneClean, process.env.GUPSHUP_TEMPLATE_QUEUE_JOIN, [
      venue.name,
      guestName,
      String(position),
      String(waitMinutes),
      statusUrl,
    ]).then(result => {
      if (result) {
        prisma.notification.create({
          data: {
            id: generateId(),
            queueEntryId: entry.id,
            channel: 'whatsapp',
            status: 'sent',
            payload: 'queue_join',
          },
        }).catch(e => console.error('Notification log error:', e));
      }
    });
    
    res.json({ success: true, entry, position, waitMinutes });
  } catch (error) {
    console.error('Join queue error:', error);
    res.status(500).json({ error: 'Failed to join queue' });
  }
});

// Get live queue (authed — staff view)
router.get('/live/:venueId', requireAuth, requireActiveSubscription, async (req, res) => {
  try {
    const venue = await prisma.venue.findFirst({
      where: { id: req.params.venueId, ownerId: req.ownerId },
    });
    if (!venue) return res.status(404).json({ error: 'Venue not found' });

    const entries = await prisma.queueEntry.findMany({
      where: { venueId: venue.id, status: { in: ['waiting', 'notified'] } },
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
      where: { venueId: entry.venueId, status: { in: ['waiting', 'notified'] } },
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
router.post('/notify/:entryId', requireAuth, requireActiveSubscription, async (req, res) => {
  try {
    const entry = await prisma.queueEntry.findUnique({
      where: { id: req.params.entryId },
      include: { venue: true },
    });
    if (!entry) return res.status(404).json({ error: 'Entry not found' });
    if (entry.venue.ownerId !== req.ownerId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const { reportingTime } = req.body;
    
    await prisma.queueEntry.update({
      where: { id: entry.id },
      data: { notifiedAt: new Date(), status: 'notified' },
    });

    await logAudit(entry.id, 'notified', reportingTime ? `Reporting time: ${reportingTime} mins` : null);

    // Fire WhatsApp table-ready message (non-blocking)
    sendTemplate(entry.guestPhone, process.env.GUPSHUP_TEMPLATE_TABLE_READY, [
      entry.guestName,
      entry.venue.name,
      String(reportingTime || 5),
    ]).then(result => {
      if (result) {
        prisma.notification.create({
          data: {
            id: generateId(),
            queueEntryId: entry.id,
            channel: 'whatsapp',
            status: 'sent',
            payload: 'table_ready',
          },
        }).catch(e => console.error('Notification log error:', e));
      }
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Notify error:', error);
    res.status(500).json({ error: 'Failed to notify' });
  }
});

// Mark as seated (authed)
router.post('/seat/:entryId', requireAuth, requireActiveSubscription, async (req, res) => {
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

    await logAudit(entry.id, 'seated');

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
    await logAudit(req.params.entryId, 'cancelled');
    res.json({ success: true });
  } catch (error) {
    console.error('Cancel error:', error);
    res.status(500).json({ error: 'Failed to cancel' });
  }
});

// Get queue history (today's entries — all statuses)
router.get('/history/:venueId', requireAuth, requireActiveSubscription, async (req, res) => {
  try {
    const venue = await prisma.venue.findFirst({
      where: { id: req.params.venueId, ownerId: req.ownerId },
    });
    if (!venue) return res.status(404).json({ error: 'Venue not found' });

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const entries = await prisma.queueEntry.findMany({
      where: {
        venueId: venue.id,
        joinedAt: { gte: startOfDay },
        status: { in: ['seated', 'cancelled'] },
      },
      orderBy: { joinedAt: 'desc' },
      include: { auditLogs: { orderBy: { createdAt: 'asc' } } },
    });

    res.json({ entries });
  } catch (error) {
    console.error('History error:', error);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// Clear queue (cancel all waiting/notified entries)
router.post('/clear/:venueId', requireAuth, requireActiveSubscription, async (req, res) => {
  try {
    const venue = await prisma.venue.findFirst({
      where: { id: req.params.venueId, ownerId: req.ownerId },
    });
    if (!venue) return res.status(404).json({ error: 'Venue not found' });

    await prisma.queueEntry.updateMany({
      where: {
        venueId: venue.id,
        status: { in: ['waiting', 'notified'] },
      },
      data: { status: 'cancelled', cancelledAt: new Date() },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Clear queue error:', error);
    res.status(500).json({ error: 'Failed to clear queue' });
  }
});

// Today's stats
router.get('/stats/:venueId', requireAuth, requireActiveSubscription, async (req, res) => {
  try {
    const venue = await prisma.venue.findFirst({
      where: { id: req.params.venueId, ownerId: req.ownerId },
    });
    if (!venue) return res.status(404).json({ error: 'Venue not found' });

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const entries = await prisma.queueEntry.findMany({
      where: { venueId: venue.id, joinedAt: { gte: startOfDay } },
    });

    const totalGuests = entries.length;
    const seated = entries.filter(e => e.status === 'seated' && e.seatedAt);
    const avgWaitMinutes = seated.length > 0
      ? Math.round(
          seated.reduce((sum, e) => sum + (new Date(e.seatedAt) - new Date(e.joinedAt)) / 60000, 0) / seated.length
        )
      : 0;

    res.json({ totalGuests, seatedCount: seated.length, avgWaitMinutes });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Get audit log for a queue entry
router.get('/audit/:entryId', requireAuth, requireActiveSubscription, async (req, res) => {
  try {
    const entry = await prisma.queueEntry.findUnique({
      where: { id: req.params.entryId },
      include: { venue: true },
    });
    if (!entry) return res.status(404).json({ error: 'Entry not found' });
    if (entry.venue.ownerId !== req.ownerId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const logs = await prisma.auditLog.findMany({
      where: { queueEntryId: req.params.entryId },
      orderBy: { createdAt: 'asc' },
    });

    res.json({ entry, logs });
  } catch (error) {
    console.error('Audit fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch audit log' });
  }
});

// Mark guest as called (logs the call action — does not actually dial)
router.post('/call/:entryId', requireAuth, requireActiveSubscription, async (req, res) => {
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
      data: { calledAt: new Date() },
    });

    await logAudit(entry.id, 'called');

    res.json({ success: true });
  } catch (error) {
    console.error('Call error:', error);
    res.status(500).json({ error: 'Failed to log call' });
  }
});

// Analytics — today + past 7 days
router.get('/analytics/:venueId', requireAuth, requireActiveSubscription, async (req, res) => {
  try {
    const venue = await prisma.venue.findFirst({
      where: { id: req.params.venueId, ownerId: req.ownerId },
    });
    if (!venue) return res.status(404).json({ error: 'Venue not found' });

    const now = new Date();
    const range = req.query.range || 'L7D';
    let startDate;
    let endDate = new Date(now);

    if (range === 'L7D') {
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 6);
      startDate.setHours(0, 0, 0, 0);
    } else if (range === 'MTD') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (range === 'YTD') {
      startDate = new Date(now.getFullYear(), 0, 1);
    } else if (range === 'L3M') {
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 90);
      startDate.setHours(0, 0, 0, 0);
    } else if (range === 'L6M') {
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 180);
      startDate.setHours(0, 0, 0, 0);
    } else if (range === 'L1Y') {
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 365);
      startDate.setHours(0, 0, 0, 0);
    } else if (range === 'LM') {
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      endDate = new Date(now.getFullYear(), now.getMonth(), 1);
    } else {
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 6);
      startDate.setHours(0, 0, 0, 0);
    }

    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const allInRange = await prisma.queueEntry.findMany({
      where: { venueId: venue.id, joinedAt: { gte: startDate, lt: endDate } },
    });

    // Today's metrics (always today, regardless of range)
    const todayEntries = allInRange.filter(e => new Date(e.joinedAt) >= startOfToday && new Date(e.joinedAt) < new Date(startOfToday.getTime() + 86400000));
    const todaySeated = todayEntries.filter(e => e.status === 'seated' && e.seatedAt);
    const todayCancelled = todayEntries.filter(e => e.status === 'cancelled');
    const todayAvgWait = todaySeated.length > 0
      ? Math.round(todaySeated.reduce((sum, e) => sum + (new Date(e.seatedAt) - new Date(e.joinedAt)) / 60000, 0) / todaySeated.length)
      : 0;

    // Daily buckets for the range
    const daily = [];
    const dayMs = 86400000;
    const numDays = Math.ceil((endDate - startDate) / dayMs);
    for (let i = 0; i < numDays; i++) {
      const d = new Date(startDate.getTime() + i * dayMs);
      const next = new Date(d.getTime() + dayMs);
      const count = allInRange.filter(e => new Date(e.joinedAt) >= d && new Date(e.joinedAt) < next).length;
      daily.push({ date: d.toISOString().split('T')[0], count });
    }

    // Hours
    const hours = Array(24).fill(0);
    allInRange.forEach(e => {
      const hr = new Date(e.joinedAt).getHours();
      hours[hr]++;
    });

    // Avg party size
    const avgPartySize = allInRange.length > 0
      ? (allInRange.reduce((sum, e) => sum + e.partySize, 0) / allInRange.length).toFixed(1)
      : 0;

    // Wait by party size
    const seatedAll = allInRange.filter(e => e.status === 'seated' && e.seatedAt);
    const byPartySize = {};
    seatedAll.forEach(e => {
      const ps = e.partySize;
      if (!byPartySize[ps]) byPartySize[ps] = { total: 0, wait: 0 };
      byPartySize[ps].total++;
      byPartySize[ps].wait += (new Date(e.seatedAt) - new Date(e.joinedAt)) / 60000;
    });
    const waitByPartySize = Object.keys(byPartySize)
      .sort((a, b) => parseInt(a) - parseInt(b))
      .map(ps => ({
        partySize: parseInt(ps),
        count: byPartySize[ps].total,
        avgWait: Math.round(byPartySize[ps].wait / byPartySize[ps].total),
      }));

    res.json({
      today: {
        guests: todayEntries.length,
        seated: todaySeated.length,
        cancelled: todayCancelled.length,
        avgWait: todayAvgWait,
      },
      daily,
      hours,
      avgPartySize,
      waitByPartySize,
      range,
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

module.exports = router;
