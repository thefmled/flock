const express = require('express');
const prisma = require('../lib/prisma');
const { broadcast } = require('../lib/realtime');
const { requireAuth, requireActiveSubscription } = require('../middleware/auth');
const { sendTemplate } = require('../lib/whatsapp');

const router = express.Router();

function generateId() {
  return 'c' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Returns a Date representing midnight IST (Asia/Kolkata) for the given offset in days.
// offset=0 → today at IST 00:00 expressed in UTC. offset=-7 → 7 days ago.
function istStartOfDay(offsetDays = 0) {
  const now = new Date();
  // Get IST date components by formatting in IST timezone
  const istDateStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // 'YYYY-MM-DD'
  // Anchor at IST midnight, expressed as UTC
  const d = new Date(istDateStr + 'T00:00:00+05:30');
  d.setDate(d.getDate() + offsetDays);
  return d;
}

// Build an entry payload for WS broadcasts, enriched with the latest table-ready
// notification status. Pass `overrides` to set fields explicitly (e.g. set
// lastNotificationStatus='pending' on a fresh notify before the record exists).
async function enrichEntryForBroadcast(entryId, overrides = {}) {
  const entry = await prisma.queueEntry.findUnique({ where: { id: entryId } });
  if (!entry) return null;
  const latestNotif = await prisma.notification.findFirst({
    where: { queueEntryId: entryId, payload: 'table_ready' },
    orderBy: { sentAt: 'desc' },
  });
  return {
    ...entry,
    lastNotificationStatus: latestNotif?.status || null,
    ...overrides,
  };
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

async function computeWaitTimes(entries, venue, options = {}) {
  const readOnly = options.readOnly === true;
  const waitTimes = [];
  const updates = [];

  for (let idx = 0; idx < entries.length; idx++) {
    const entry = entries[idx];
    const currentPos = idx + 1;
    const inc = entry.waitTimeIncrementAtJoin ?? venue.waitTimeIncrement;
    const cap = entry.waitTimeCapAtJoin ?? venue.waitTimeCap;

    const updateData = {};

    if (entry.lastPosition !== currentPos) {
      // Position changed — record new entry time. Preserve lockedWait as ceiling.
      updateData.lastPosition = currentPos;
      updateData.positionEnteredAt = new Date();
      // Only write startingWait if it's not already null (avoid noise)
      if (entry.startingWait !== null) {
        updateData.startingWait = null;
      }
      entry.lastPosition = currentPos;
      entry.positionEnteredAt = new Date();
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

  if (!readOnly && updates.length > 0) {
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
    const allWaiting = await prisma.queueEntry.findMany({
      where: { venueId: venue.id, status: { in: ['waiting', 'notified'] } },
      orderBy: { joinedAt: 'asc' },
    });
    const position = allWaiting.findIndex(e => e.id === entry.id) + 1;
    const waitTimes = await computeWaitTimes(allWaiting, venue);
    const waitMinutes = waitTimes[position - 1];

    // Fire WhatsApp queue-joined message (non-blocking)
    broadcast('venue:' + venue.id, { type: 'queue_changed' });
    broadcast('entry:' + entry.id, { type: 'entry_changed' });
    sendTemplate(phoneClean, process.env.GUPSHUP_TEMPLATE_QUEUE_JOIN, [
      venue.name,
      guestName,
      String(position),
      String(waitMinutes),
    ], [entry.id]).then(result => {
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

    // Compute visit history per unique phone — single grouped aggregate query
    // (DB does the counting; we don't pull every historical row)
    const phones = [...new Set(entries.map(e => e.guestPhone))];
    const visitData = {};
    if (phones.length > 0) {
      const aggregates = await prisma.queueEntry.groupBy({
        by: ['guestPhone'],
        where: {
          venueId: venue.id,
          guestPhone: { in: phones },
          status: 'seated', // only completed visits count
        },
        _count: { _all: true },
        _max: { joinedAt: true },
      });
      phones.forEach(phone => {
        const agg = aggregates.find(a => a.guestPhone === phone);
        visitData[phone] = {
          totalCompleted: agg ? agg._count._all : 0,
          lastVisitAt: agg ? agg._max.joinedAt : null,
        };
      });
    }

    // Latest table-ready notification per entry (for delivery indicator)
    const entryIds = entries.map(e => e.id);
    const notifMap = {};
    if (entryIds.length > 0) {
      const notifications = await prisma.notification.findMany({
        where: { queueEntryId: { in: entryIds }, payload: 'table_ready' },
        orderBy: { sentAt: 'desc' },
      });
      notifications.forEach(n => {
        if (!notifMap[n.queueEntryId]) notifMap[n.queueEntryId] = n.status;
      });
    }

    const enriched = entries.map((entry, idx) => {
      const visit = visitData[entry.guestPhone] || { totalCompleted: 0, lastVisitAt: null };
      const visitNumber = visit.totalCompleted + 1;
      return {
        ...entry,
        position: idx + 1,
        waitMinutes: waitTimes[idx],
        visitNumber,
        lastVisitAt: visit.lastVisitAt,
        lastNotificationStatus: notifMap[entry.id] || null,
      };
    });
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
      include: { venue: { include: { menus: { orderBy: { createdAt: 'asc' } } } } },
    });
    if (!entry) return res.status(404).json({ error: 'Entry not found' });

    const allWaiting = await prisma.queueEntry.findMany({
      where: { venueId: entry.venueId, status: { in: ['waiting', 'notified'] } },
      orderBy: { joinedAt: 'asc' },
      include: { venue: false },
    });
    const position = allWaiting.findIndex(e => e.id === entry.id) + 1;
    const waitMinutes = position > 0
      ? (await computeWaitTimes(allWaiting, entry.venue, { readOnly: true }))[position - 1]
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
    if (entry.status === 'seated' || entry.status === 'cancelled') {
      return res.status(409).json({ error: 'Entry is no longer in queue', currentStatus: entry.status });
    }

    const { reportingTime } = req.body;
    
    await prisma.queueEntry.update({
      where: { id: entry.id },
      data: { notifiedAt: new Date(), status: 'notified' },
    });

    logAudit(entry.id, 'notified', reportingTime ? `Reporting in ${reportingTime} min` : null);
    // Broadcast with explicit 'pending' status — Notification row will be created in the async chain below
    const broadcastEntry = await enrichEntryForBroadcast(entry.id, { lastNotificationStatus: 'pending' });
    broadcast('venue:' + entry.venueId, { type: 'entry_updated', entry: broadcastEntry });
    broadcast('entry:' + entry.id, { type: 'entry_changed', entry: broadcastEntry });

    // Track WhatsApp delivery: create → send → update. Chain ensures the update
    // always finds the row regardless of which DB/API call finishes first.
    const notifId = generateId();
    (async () => {
      try {
        await prisma.notification.create({
          data: {
            id: notifId,
            queueEntryId: entry.id,
            channel: 'whatsapp',
            status: 'pending',
            payload: 'table_ready',
          },
        });
        const result = await sendTemplate(entry.guestPhone, process.env.GUPSHUP_TEMPLATE_TABLE_READY, [
          entry.guestName,
          entry.venue.name,
          String(reportingTime || 5),
        ]);
        const newStatus = result ? 'sent' : 'failed';
        await prisma.notification.update({
          where: { id: notifId },
          data: { status: newStatus },
        });
        // Re-broadcast so dashboard updates the delivery badge
        const latest = await prisma.queueEntry.findUnique({ where: { id: entry.id } });
        if (latest && latest.status === 'notified') {
          broadcast('venue:' + entry.venueId, { type: 'queue_changed' });
        }
      } catch (e) {
        console.error('Notify delivery tracking error:', e);
      }
    })();

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
    if (entry.status === 'seated' || entry.status === 'cancelled') {
      return res.status(409).json({ error: 'Entry is no longer in queue', currentStatus: entry.status });
    }

    await prisma.queueEntry.update({
      where: { id: entry.id },
      data: { seatedAt: new Date(), status: 'seated' },
    });

    logAudit(entry.id, 'seated');
    broadcast('venue:' + entry.venueId, { type: 'queue_changed' });
    broadcast('entry:' + entry.id, { type: 'entry_changed' });
    res.json({ success: true });
  } catch (error) {
    console.error('Seat error:', error);
    res.status(500).json({ error: 'Failed to seat guest' });
  }
});

// Cancel entry (public — guest can self-cancel, also authed for staff)
router.post('/cancel/:entryId', async (req, res) => {
  try {
    const current = await prisma.queueEntry.findUnique({ where: { id: req.params.entryId } });
    if (!current) return res.status(404).json({ error: 'Entry not found' });
    if (current.status === 'seated' || current.status === 'cancelled') {
      return res.status(409).json({ error: 'Entry is no longer in queue', currentStatus: current.status });
    }
    await prisma.queueEntry.update({
      where: { id: req.params.entryId },
      data: { cancelledAt: new Date(), status: 'cancelled' },
    });
    logAudit(req.params.entryId, 'cancelled');
    const cancelledEntry = await prisma.queueEntry.findUnique({ where: { id: req.params.entryId } });
    if (cancelledEntry) {
      broadcast('venue:' + cancelledEntry.venueId, { type: 'queue_changed' });
      broadcast('entry:' + cancelledEntry.id, { type: 'entry_changed' });
    }
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

    const startOfDay = istStartOfDay();

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

    // Get the entries being cancelled BEFORE bulk update so we can log per-entry
    const toCancel = await prisma.queueEntry.findMany({
      where: {
        venueId: venue.id,
        status: { in: ['waiting', 'notified'] },
      },
      select: { id: true },
    });

    await prisma.queueEntry.updateMany({
      where: {
        venueId: venue.id,
        status: { in: ['waiting', 'notified'] },
      },
      data: { status: 'cancelled', cancelledAt: new Date() },
    });

    // Fire-and-forget audit logs + per-entry broadcast so each guest's status page updates
    // immediately (status pages subscribe to entry:<id>, not the venue channel).
    for (const e of toCancel) {
      logAudit(e.id, 'cancelled', 'queue cleared by staff');
      broadcast('entry:' + e.id, { type: 'entry_changed' });
    }

    broadcast('venue:' + req.params.venueId, { type: 'queue_changed' });
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

    const startOfDay = istStartOfDay();

    const entries = await prisma.queueEntry.findMany({
      where: { venueId: venue.id, joinedAt: { gte: startOfDay } },
    });

    const totalGuests = entries.length;
    const seated = entries.filter(e => e.status === 'seated' && e.seatedAt);
    const cancelled = entries.filter(e => e.status === 'cancelled');
    const avgWaitMinutes = seated.length > 0
      ? Math.round(
          seated.reduce((sum, e) => sum + (new Date(e.seatedAt) - new Date(e.joinedAt)) / 60000, 0) / seated.length
        )
      : 0;

    res.json({ totalGuests, seatedCount: seated.length, cancelledCount: cancelled.length, avgWaitMinutes });
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
    if (entry.status === 'cancelled') {
      return res.status(409).json({ error: 'Entry is no longer in queue', currentStatus: entry.status });
    }

    await prisma.queueEntry.update({
      where: { id: entry.id },
      data: { calledAt: new Date() },
    });

    logAudit(entry.id, 'called');

    const broadcastEntry = await enrichEntryForBroadcast(entry.id);
    broadcast('venue:' + entry.venueId, { type: 'entry_updated', entry: broadcastEntry });
    broadcast('entry:' + entry.id, { type: 'entry_changed', entry: broadcastEntry });

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

    // Today (IST) as the right edge for daily bucketing
    const istToday = istStartOfDay();
    // Helper: get IST midnight of MTD/YTD
    const istMonthStart = (() => {
      const istDateStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      const [y, m] = istDateStr.split('-');
      return new Date(`${y}-${m}-01T00:00:00+05:30`);
    })();
    const istYearStart = (() => {
      const istDateStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      const [y] = istDateStr.split('-');
      return new Date(`${y}-01-01T00:00:00+05:30`);
    })();

    if (range === 'L7D') {
      startDate = istStartOfDay(-6);
    } else if (range === 'MTD') {
      startDate = istMonthStart;
    } else if (range === 'YTD') {
      startDate = istYearStart;
    } else if (range === 'L3M') {
      startDate = istStartOfDay(-90);
    } else if (range === 'L6M') {
      startDate = istStartOfDay(-180);
    } else if (range === 'L1Y') {
      startDate = istStartOfDay(-365);
    } else if (range === 'LM') {
      startDate = istStartOfDay(-30);
    } else {
      startDate = istStartOfDay(-6);
    }

    const startOfToday = istStartOfDay();

    const allInRange = await prisma.queueEntry.findMany({
      where: { venueId: venue.id, joinedAt: { gte: startDate, lt: endDate } },
      select: {
        joinedAt: true,
        seatedAt: true,
        cancelledAt: true,
        status: true,
        partySize: true,
      },
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
      const dayEntries = allInRange.filter(e => new Date(e.joinedAt) >= d && new Date(e.joinedAt) < next);
      const avgParty = dayEntries.length > 0
        ? dayEntries.reduce((sum, e) => sum + e.partySize, 0) / dayEntries.length
        : 0;
      daily.push({
        date: d.toISOString().split('T')[0],
        dayOfWeek: d.getDay(), // 0 = Sunday, 1 = Monday...
        count: dayEntries.length,
        avgPartySize: parseFloat(avgParty.toFixed(1)),
      });
    }

    // Hours — grouped by day-of-week (so frontend can compute weighted averages)
    // hoursByDow[dow][hour] = count
    const hoursByDow = Array.from({ length: 7 }, () => Array(24).fill(0));
    const daysSeen = Array.from({ length: 7 }, () => new Set());
    allInRange.forEach(e => {
      const d = new Date(e.joinedAt);
      const istDate = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
      const dow = istDate.getUTCDay();
      const hr = istDate.getUTCHours();
      hoursByDow[dow][hr]++;
      daysSeen[dow].add(istDate.toISOString().split('T')[0]);
    });
    const dowDayCounts = daysSeen.map(s => s.size);

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
      hours: hoursByDow.reduce((acc, dowArr) => acc.map((v, i) => v + dowArr[i]), Array(24).fill(0)),
      hoursByDow,
      dowDayCounts,
      avgPartySize,
      waitByPartySize,
      range,
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// Lightweight check — does this venue have at least one queue entry?
router.get('/has-any/:venueId', requireAuth, requireActiveSubscription, async (req, res) => {
  try {
    const venue = await prisma.venue.findFirst({
      where: { id: req.params.venueId, ownerId: req.ownerId },
    });
    if (!venue) return res.status(404).json({ error: 'Venue not found' });

    const count = await prisma.queueEntry.count({
      where: { venueId: venue.id },
    });

    res.json({ hasAny: count > 0 });
  } catch (error) {
    console.error('Has-any error:', error);
    res.status(500).json({ error: 'Failed to check' });
  }
});

// Report data — full export with metrics + guest entries for the given range
router.get('/report/:venueId', requireAuth, requireActiveSubscription, async (req, res) => {
  try {
    const venue = await prisma.venue.findFirst({
      where: { id: req.params.venueId, ownerId: req.ownerId },
    });
    if (!venue) return res.status(404).json({ error: 'Venue not found' });

    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;
    if (!from || !to) return res.status(400).json({ error: 'from and to required' });

    // Make 'to' inclusive of the whole day
    const toEnd = new Date(to);
    toEnd.setHours(23, 59, 59, 999);

    const entries = await prisma.queueEntry.findMany({
      where: { venueId: venue.id, joinedAt: { gte: from, lte: toEnd } },
      orderBy: { joinedAt: 'asc' },
    });

    // Daily buckets
    const daily = [];
    const dayMs = 86400000;
    const start = new Date(from); start.setHours(0,0,0,0);
    const end = new Date(toEnd); end.setHours(0,0,0,0);
    const numDays = Math.ceil((end - start) / dayMs) + 1;
    for (let i = 0; i < numDays; i++) {
      const d = new Date(start.getTime() + i * dayMs);
      const next = new Date(d.getTime() + dayMs);
      const dayEntries = entries.filter(e => new Date(e.joinedAt) >= d && new Date(e.joinedAt) < next);
      const avgParty = dayEntries.length > 0
        ? dayEntries.reduce((s, e) => s + e.partySize, 0) / dayEntries.length
        : 0;
      daily.push({
        date: d.toISOString().split('T')[0],
        dayOfWeek: d.getDay(),
        count: dayEntries.length,
        avgPartySize: parseFloat(avgParty.toFixed(1)),
      });
    }

    // Hours by day-of-week
    const hoursByDow = Array.from({ length: 7 }, () => Array(24).fill(0));
    const daysSeen = Array.from({ length: 7 }, () => new Set());
    entries.forEach(e => {
      const d = new Date(e.joinedAt);
      const istDate = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
      const dow = istDate.getUTCDay();
      const hr = istDate.getUTCHours();
      hoursByDow[dow][hr]++;
      daysSeen[dow].add(istDate.toISOString().split('T')[0]);
    });
    const dowDayCounts = daysSeen.map(s => s.size);

    // Wait stats
    const seated = entries.filter(e => e.seatedAt);
    const waitTimes = seated.map(e => (new Date(e.seatedAt) - new Date(e.joinedAt)) / 60000);
    waitTimes.sort((a, b) => a - b);
    const avgWait = waitTimes.length > 0 ? Math.round(waitTimes.reduce((s, w) => s + w, 0) / waitTimes.length) : 0;
    const median = waitTimes.length > 0 ? Math.round(waitTimes[Math.floor(waitTimes.length / 2)]) : 0;

    const byPartySizeMap = {};
    seated.forEach(e => {
      if (!byPartySizeMap[e.partySize]) byPartySizeMap[e.partySize] = { total: 0, wait: 0 };
      byPartySizeMap[e.partySize].total++;
      byPartySizeMap[e.partySize].wait += (new Date(e.seatedAt) - new Date(e.joinedAt)) / 60000;
    });
    const byPartySize = Object.keys(byPartySizeMap)
      .sort((a, b) => parseInt(a) - parseInt(b))
      .map(ps => ({
        partySize: parseInt(ps),
        count: byPartySizeMap[ps].total,
        avgWait: Math.round(byPartySizeMap[ps].wait / byPartySizeMap[ps].total),
      }));

    // Cancellation stats
    const cancelled = entries.filter(e => e.status === 'cancelled').length;
    const cancelStats = {
      total: entries.length,
      cancelled,
      rate: entries.length > 0 ? ((cancelled / entries.length) * 100).toFixed(1) : '0.0',
    };

    res.json({
      entries,
      daily,
      hoursByDow,
      dowDayCounts,
      waitStats: { avg: avgWait, median, byPartySize },
      cancelStats,
    });
  } catch (error) {
    console.error('Report error:', error);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

// Insights — heuristic-based recommendations from venue's queue data
router.get('/insights/:venueId', requireAuth, requireActiveSubscription, async (req, res) => {
  try {
    const venue = await prisma.venue.findFirst({
      where: { id: req.params.venueId, ownerId: req.ownerId },
    });
    if (!venue) return res.status(404).json({ error: 'Venue not found' });

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400000);
    
    const entries = await prisma.queueEntry.findMany({
      where: { venueId: venue.id, joinedAt: { gte: thirtyDaysAgo } },
      orderBy: { joinedAt: 'asc' },
    });
    
    const insights = [];

    if (entries.length < 5) {
      insights.push({
        id: 'not_enough_data',
        severity: 'info',
        title: 'Not enough data yet',
        metric: entries.length + ' guests so far',
        body: 'Insights will appear as you get more guests through the queue. Aim for at least 14 days of activity for the best signal.',
      });
      return res.json({ insights, hasData: entries.length > 0 });
    }

    // Helper — IST conversion
    const toIST = d => new Date(new Date(d).getTime() + 5.5 * 3600 * 1000);

    // 1. Wait time accuracy — predicted vs actual
    const seatedWithPrediction = entries.filter(e => e.seatedAt && e.waitTimeBaseAtJoin);
    if (seatedWithPrediction.length >= 10) {
      let totalOvershoot = 0;
      seatedWithPrediction.forEach(e => {
        const predicted = e.waitTimeBaseAtJoin + (e.waitTimeIncrementAtJoin || 3);
        const actual = (new Date(e.seatedAt) - new Date(e.joinedAt)) / 60000;
        totalOvershoot += (actual - predicted);
      });
      const avgOvershoot = Math.round(totalOvershoot / seatedWithPrediction.length);
      if (Math.abs(avgOvershoot) >= 5) {
        insights.push({
          id: 'wait_accuracy',
          severity: avgOvershoot > 0 ? 'warning' : 'good',
          title: avgOvershoot > 0 ? 'Wait times are running longer than predicted' : 'Wait times are beating predictions',
          metric: (avgOvershoot > 0 ? '+' : '') + avgOvershoot + ' min vs predicted',
          body: avgOvershoot > 0
            ? 'On average, guests wait ' + avgOvershoot + ' min longer than what they\'re told. Consider raising your base wait time in Settings, or noting this in the queue message.'
            : 'Guests are being seated ' + Math.abs(avgOvershoot) + ' min faster than expected. You could lower your base wait estimate to be more accurate.',
        });
      } else {
        insights.push({
          id: 'wait_accuracy_good',
          severity: 'good',
          title: 'Wait predictions are accurate',
          metric: 'Within ' + Math.abs(avgOvershoot) + ' min',
          body: 'Your predicted wait times match what guests actually experience. Keep it up.',
        });
      }
    }

    // 2. Cancellation trend — last 7 days vs prior 7
    const last7 = entries.filter(e => new Date(e.joinedAt) >= sevenDaysAgo);
    const prior7 = entries.filter(e => new Date(e.joinedAt) >= fourteenDaysAgo && new Date(e.joinedAt) < sevenDaysAgo);
    if (last7.length >= 5 && prior7.length >= 5) {
      const last7Cancel = last7.filter(e => e.status === 'cancelled').length / last7.length;
      const prior7Cancel = prior7.filter(e => e.status === 'cancelled').length / prior7.length;
      const delta = ((last7Cancel - prior7Cancel) / Math.max(prior7Cancel, 0.01)) * 100;
      if (Math.abs(delta) >= 25) {
        insights.push({
          id: 'cancel_trend',
          severity: delta > 0 ? 'warning' : 'good',
          title: delta > 0 ? 'Cancellation rate is climbing' : 'Fewer cancellations this week',
          metric: (last7Cancel * 100).toFixed(0) + '% this week vs ' + (prior7Cancel * 100).toFixed(0) + '% last',
          body: delta > 0
            ? 'More guests are leaving the queue before being seated. Possible causes: wait times feel too long, no notification reaching them, or poor seating mix. Check your wait time accuracy and notification delivery.'
            : 'Cancellations dropped — whatever you changed is working.',
        });
      }
    }

    // 3. Peak hour pressure — when does queue stack up?
    const hourCountsByDow = Array.from({ length: 7 }, () => Array(24).fill(0));
    entries.forEach(e => {
      const d = toIST(e.joinedAt);
      hourCountsByDow[d.getUTCDay()][d.getUTCHours()]++;
    });
    let maxHour = { dow: -1, hour: -1, count: 0 };
    for (let dow = 0; dow < 7; dow++) {
      for (let h = 0; h < 24; h++) {
        if (hourCountsByDow[dow][h] > maxHour.count) {
          maxHour = { dow, hour: h, count: hourCountsByDow[dow][h] };
        }
      }
    }
    const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    if (maxHour.count >= 5) {
      insights.push({
        id: 'peak_hour',
        severity: 'info',
        title: 'Your peak is ' + DAYS[maxHour.dow] + ' at ' + maxHour.hour + ':00',
        metric: maxHour.count + ' parties joined this hour over the last 30 days',
        body: 'Make sure you have staffing and seating ready for this slot. If wait times spike here, consider pre-bookings or a different floor layout.',
      });
    }

    // 4. Repeat guests
    const phoneCounts = {};
    entries.forEach(e => {
      if (e.guestPhone) phoneCounts[e.guestPhone] = (phoneCounts[e.guestPhone] || 0) + 1;
    });
    const repeatGuests = Object.values(phoneCounts).filter(c => c > 1).length;
    const totalUnique = Object.keys(phoneCounts).length;
    if (totalUnique >= 10) {
      const repeatRate = (repeatGuests / totalUnique) * 100;
      insights.push({
        id: 'repeat_guests',
        severity: repeatRate >= 15 ? 'good' : 'warning',
        title: repeatRate >= 15 ? 'Healthy repeat guest rate' : 'Few guests are returning',
        metric: repeatGuests + ' of ' + totalUnique + ' guests have been here multiple times (' + repeatRate.toFixed(0) + '%)',
        body: repeatRate >= 15
          ? 'You have a loyal base. Consider rewarding regulars to deepen the relationship — birthday acknowledgments, a thank-you message after their 5th visit, or a small perk.'
          : 'Most guests visit once. Could be a discovery business (tourists, drop-ins) — or there\'s an opportunity to bring people back. A simple win-back message at 30/60 days could help.',
      });
    }

    // 5. No-show rate (notified but never seated)
    const notifiedTotal = entries.filter(e => e.notifiedAt).length;
    const notifiedNoShow = entries.filter(e => e.notifiedAt && !e.seatedAt && e.status !== 'waiting' && e.status !== 'notified').length;
    if (notifiedTotal >= 10) {
      const noShowRate = (notifiedNoShow / notifiedTotal) * 100;
      if (noShowRate >= 8) {
        insights.push({
          id: 'no_show',
          severity: 'warning',
          title: 'High no-show rate after notifying',
          metric: noShowRate.toFixed(0) + '% (' + notifiedNoShow + ' of ' + notifiedTotal + ' notified guests)',
          body: 'These guests got the "table ready" message but never came in. Try notifying slightly earlier so they have buffer time, or consider sending a reminder 5 min after the first notification.',
        });
      } else {
        insights.push({
          id: 'no_show_good',
          severity: 'good',
          title: 'Low no-show rate',
          metric: noShowRate.toFixed(0) + '% don\'t show after notification',
          body: 'Once guests are notified, almost everyone arrives. Your notification timing is well-calibrated.',
        });
      }
    }

    // 6. Average party size shift — split entries cleanly in half
    if (entries.length >= 20) {
      const mid = Math.floor(entries.length / 2);
      const earlierHalf = entries.slice(0, mid);
      const recentHalf = entries.slice(mid);
      const recentAvg = recentHalf.reduce((s, e) => s + e.partySize, 0) / recentHalf.length;
      const earlierAvg = earlierHalf.reduce((s, e) => s + e.partySize, 0) / earlierHalf.length;
      const delta = recentAvg - earlierAvg;
      if (Math.abs(delta) >= 0.5) {
        insights.push({
          id: 'party_size_shift',
          severity: 'info',
          title: delta > 0 ? 'Party sizes are growing' : 'Party sizes are shrinking',
          metric: 'Avg: ' + earlierAvg.toFixed(1) + ' → ' + recentAvg.toFixed(1),
          body: delta > 0
            ? 'You\'re seeing bigger groups recently. Make sure you have large-party seating available, or consider expanding combinable tables.'
            : 'You\'re seeing smaller groups recently. Could be a shift in your weekday vs weekend mix or a change in customer demographics worth noting.',
        });
      }
    }

    // 7. Slow days
    const dayTotals = Array(7).fill(0);
    const daysSeen = Array.from({ length: 7 }, () => new Set());
    entries.forEach(e => {
      const d = toIST(e.joinedAt);
      const dow = d.getUTCDay();
      dayTotals[dow]++;
      daysSeen[dow].add(d.toISOString().split('T')[0]);
    });
    const dayAverages = dayTotals.map((t, dow) => daysSeen[dow].size > 0 ? t / daysSeen[dow].size : 0);
    const maxDayAvg = Math.max(...dayAverages);
    const slowestDay = dayAverages.indexOf(Math.min(...dayAverages.filter(v => v > 0)));
    if (maxDayAvg > 0 && slowestDay >= 0 && dayAverages[slowestDay] < maxDayAvg * 0.4) {
      insights.push({
        id: 'slow_day',
        severity: 'info',
        title: DAYS[slowestDay] + 's are your quietest',
        metric: dayAverages[slowestDay].toFixed(1) + ' avg parties vs ' + maxDayAvg.toFixed(1) + ' on your busy days',
        body: DAYS[slowestDay] + ' has under 40% of your peak day traffic. Could be a chance to test a midweek promo, a tasting menu, or staff training.',
      });
    }

    // 8. Hour utilization (dead hours)
    const totalHours = Array(24).fill(0);
    entries.forEach(e => {
      const d = toIST(e.joinedAt);
      totalHours[d.getUTCHours()]++;
    });
    const activeHours = totalHours.map((c, h) => ({ h, c })).filter(x => x.c > 0);
    if (activeHours.length >= 3) {
      const totalEntries = entries.length;
      const firstActiveHour = activeHours[0];
      const lastActiveHour = activeHours[activeHours.length - 1];
      const firstHourShare = firstActiveHour.c / totalEntries;
      const lastHourShare = lastActiveHour.c / totalEntries;
      if (firstHourShare < 0.05 && firstActiveHour.c >= 1) {
        insights.push({
          id: 'dead_open',
          severity: 'info',
          title: 'Quiet first hour of service',
          metric: (firstHourShare * 100).toFixed(0) + '% of traffic in the first active hour (' + firstActiveHour.h + ':00)',
          body: 'Almost no one shows up in your first hour. Could consider opening later, or running an early-bird promo to fill the slot.',
        });
      }
      if (lastHourShare < 0.05 && lastActiveHour.c >= 1) {
        insights.push({
          id: 'dead_close',
          severity: 'info',
          title: 'Quiet last hour of service',
          metric: (lastHourShare * 100).toFixed(0) + '% of traffic in the last active hour (' + lastActiveHour.h + ':00)',
          body: 'Very few guests in your closing hour. Consider closing slightly earlier or running a late-night discount.',
        });
      }
    }

    res.json({ insights, hasData: true });
  } catch (error) {
    console.error('Insights error:', error);
    res.status(500).json({ error: 'Failed to compute insights' });
  }
});

module.exports = router;
