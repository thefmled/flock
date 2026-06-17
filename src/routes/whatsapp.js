const express = require('express');
const prisma = require('../lib/prisma');
const { broadcast } = require('../lib/realtime');

const router = express.Router();

// Gupshup inbound webhook, receives guest replies
router.post('/inbound', express.json(), async (req, res) => {
  try {
    // Verify shared secret
    const secret = req.query.secret;
    if (secret !== process.env.GUPSHUP_WEBHOOK_SECRET) {
      console.warn('Inbound webhook: invalid secret');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const payload = req.body;
    // Gupshup inbound message format
    // We expect type=message with text payload (button click sends text=button label)
    // Normalize phone: strip non-digits, then strip leading 91 country code if 12 digits long.
    // Handles formats: '+919876543210', '919876543210', '9876543210'
    let phone = String(payload?.payload?.sender?.phone || payload?.payload?.source || '').replace(/\D/g, '');
    if (phone.length === 12 && phone.startsWith('91')) phone = phone.slice(2);
    const text = payload?.payload?.payload?.text || payload?.payload?.text || '';
    const eventType = payload?.type;

    if (!phone || !text) {
      // Not a message we care about (status update, etc.)
      return res.json({ received: true });
    }

    if (eventType !== 'message') {
      return res.json({ received: true });
    }

    // Only act on the two expected replies
    const normalized = text.trim().toLowerCase();
    let replyType = null;
    if (normalized.includes('will be there') || normalized === 'i will be there') replyType = 'confirmed';
    else if (normalized.includes("sorry") && normalized.includes("can't")) replyType = 'declined';
    else if (normalized.includes('sorry') && normalized.includes('cant')) replyType = 'declined';

    if (!replyType) {
      // Ignore other free-form replies
      return res.json({ received: true });
    }

    // Find the most recent notified entry for this phone
    const entry = await prisma.queueEntry.findFirst({
      where: {
        guestPhone: phone,
        status: 'notified',
      },
      orderBy: { notifiedAt: 'desc' },
    });

    if (!entry) {
      return res.json({ received: true, note: 'no matching notified entry' });
    }

    await prisma.queueEntry.update({
      where: { id: entry.id },
      data: {
        guestReply: text.trim(),
        guestReplyAt: new Date(),
      },
    });

    prisma.auditLog.create({
      data: {
        queueEntryId: entry.id,
        action: 'guest_reply',
        details: text.trim(),
      },
    }).catch(() => {});

    // Enrich with lastNotificationStatus so the dashboard doesn't drop the badge
    const latestNotif = await prisma.notification.findFirst({
      where: { queueEntryId: entry.id, payload: 'table_ready' },
      orderBy: { sentAt: 'desc' },
    });
    const updatedEntry = await prisma.queueEntry.findUnique({ where: { id: entry.id } });
    const broadcastEntry = { ...updatedEntry, lastNotificationStatus: latestNotif?.status || null };

    broadcast('venue:' + entry.venueId, { type: 'entry_updated', entry: broadcastEntry });
    broadcast('entry:' + entry.id, { type: 'entry_changed', entry: broadcastEntry });

    res.json({ received: true });
  } catch (error) {
    console.error('Inbound webhook error:', error);
    res.status(500).json({ error: 'Webhook handling failed' });
  }
});

module.exports = router;
