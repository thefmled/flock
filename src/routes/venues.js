const express = require('express');

const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const { updateSubscriptionQuantity } = require('./subscription');
const { broadcast } = require('../lib/realtime');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      return cb(new Error('Only PDF files allowed'));
    }
    cb(null, true);
  },
});
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const prisma = require('../lib/prisma');
const { requireAuth, requireActiveSubscription } = require('../middleware/auth');

const router = express.Router();

function generateId() {
  return 'c' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-');
}

// Create a venue (first-time setup)
router.post('/', requireAuth, requireActiveSubscription, async (req, res) => {
  try {
    const { name, address, floorManagerName, googleReviewsUrl, theme } = req.body;

    if (!name || !address || !floorManagerName) {
      return res.status(400).json({ error: 'Name, address, and floor manager name are required' });
    }

    // Whitelist allowed themes (DB has a schema-level default, this just narrows what's accepted at creation)
    const allowedThemes = ['dark-premium', 'light-amber', 'warm-editorial', 'crisp-modern', 'forest-tavern', 'terracotta-bistro', 'midnight-indigo', 'sun-sand', 'bombay-blue', 'spice-market', 'charcoal-linen', 'brick-birch', 'cloud-mint'];
    const safeTheme = allowedThemes.includes(theme) ? theme : 'dark-premium';

    // Generate unique slug
    let baseSlug = slugify(name);
    let slug = baseSlug;
    let counter = 1;
    while (await prisma.venue.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    const { seatingOptions } = req.body;

    const venue = await prisma.venue.create({
      data: {
        id: generateId(),
        slug,
        name,
        address,
        floorManagerName,
        googleReviewsUrl: googleReviewsUrl || null,
        seatingOptions: seatingOptions || 'Indoor,Outdoor,No preference',
        theme: safeTheme,
        ownerId: req.ownerId,
      },
    });

    // Update subscription quantity to reflect new venue count
    const count = await prisma.venue.count({ where: { ownerId: req.ownerId } });
    await updateSubscriptionQuantity(req.ownerId, count);

    res.json({ success: true, venue });
  } catch (error) {
    console.error('Create venue error:', error);
    res.status(500).json({ error: 'Failed to create venue' });
  }
});

// Get venues for the logged-in owner
router.get('/', requireAuth, requireActiveSubscription, async (req, res) => {
  try {
    const venues = await prisma.venue.findMany({
      where: { ownerId: req.ownerId },
      orderBy: { createdAt: 'desc' },
    });
    res.set('Cache-Control', 'no-store');
    res.json({ venues });
  } catch (error) {
    console.error('Get venues error:', error);
    res.status(500).json({ error: 'Failed to fetch venues' });
  }
});

// Get a venue by slug (public — for guest queue page)
router.get('/by-slug/:slug', async (req, res) => {
  try {
    const venue = await prisma.venue.findUnique({
      where: { slug: req.params.slug },
      include: { menus: { orderBy: { createdAt: 'asc' } } },
    });
    if (!venue) return res.status(404).json({ error: 'Venue not found' });
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ venue });
  } catch (error) {
    console.error('Get venue by slug error:', error);
    res.status(500).json({ error: 'Failed to fetch venue' });
  }
});

// Delete a venue
router.delete('/:id', requireAuth, requireActiveSubscription, async (req, res) => {
  try {
    const venue = await prisma.venue.findFirst({
      where: { id: req.params.id, ownerId: req.ownerId },
    });
    if (!venue) return res.status(404).json({ error: 'Venue not found' });

    // Refuse to delete the last venue — Razorpay can't have quantity 0
    const totalCount = await prisma.venue.count({ where: { ownerId: req.ownerId } });
    if (totalCount === 1) {
      return res.status(400).json({
        error: "You can't delete your only venue. Cancel your subscription instead if you no longer need flock.",
      });
    }

    await prisma.venue.delete({ where: { id: venue.id } });
    const count = await prisma.venue.count({ where: { ownerId: req.ownerId } });
    await updateSubscriptionQuantity(req.ownerId, count);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete venue error:', error);
    res.status(500).json({ error: 'Failed to delete venue' });
  }
});

// Update a venue (with optimistic locking via updatedAt)
router.patch('/:id', requireAuth, requireActiveSubscription, async (req, res) => {
  try {
    const venue = await prisma.venue.findFirst({
      where: { id: req.params.id, ownerId: req.ownerId },
    });
    if (!venue) return res.status(404).json({ error: 'Venue not found' });

    const expectedUpdatedAt = req.body.expectedUpdatedAt;
    if (expectedUpdatedAt) {
      const expected = new Date(expectedUpdatedAt).getTime();
      const current = new Date(venue.updatedAt).getTime();
      if (current !== expected) {
        return res.status(409).json({
          error: 'Venue was updated by someone else',
          currentVenue: venue,
        });
      }
    }

    const allowed = ['name', 'address', 'floorManagerName', 'googleReviewsUrl', 'seatingOptions', 'noteOptions', 'waitTimeBase', 'waitTimeIncrement', 'waitTimeCap', 'theme'];
    const data = {};
    for (const key of allowed) {
      if (key in req.body) data[key] = req.body[key];
    }

    const updated = await prisma.venue.update({
      where: { id: venue.id },
      data,
    });
    broadcast('venue:' + updated.id, { type: 'venue_updated', venue: updated });
    res.json({ success: true, venue: updated });
  } catch (error) {
    console.error('Update venue error:', error);
    res.status(500).json({ error: 'Failed to update venue' });
  }
});

// Mark QR as placed
router.post('/:id/qr-placed', requireAuth, requireActiveSubscription, async (req, res) => {
  try {
    const venue = await prisma.venue.findFirst({
      where: { id: req.params.id, ownerId: req.ownerId },
    });
    if (!venue) return res.status(404).json({ error: 'Venue not found' });

    const updated = await prisma.venue.update({
      where: { id: venue.id },
      data: { qrMarkedPlaced: true },
    });
    broadcast('venue:' + updated.id, { type: 'venue_updated', venue: updated });
    res.json({ success: true, venue: updated });
  } catch (error) {
    console.error('QR placed error:', error);
    res.status(500).json({ error: 'Failed to mark QR placed' });
  }
});

// Dismiss onboarding
router.post('/:id/dismiss-onboarding', requireAuth, requireActiveSubscription, async (req, res) => {
  try {
    const venue = await prisma.venue.findFirst({
      where: { id: req.params.id, ownerId: req.ownerId },
    });
    if (!venue) return res.status(404).json({ error: 'Venue not found' });

    const updated = await prisma.venue.update({
      where: { id: venue.id },
      data: { onboardingDismissed: true },
    });
    res.json({ success: true, venue: updated });
  } catch (error) {
    console.error('Dismiss onboarding error:', error);
    res.status(500).json({ error: 'Failed to dismiss' });
  }
});

function genId() {
  return 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// List menus for a venue
router.get('/:id/menus', requireAuth, requireActiveSubscription, async (req, res) => {
  try {
    const venue = await prisma.venue.findFirst({
      where: { id: req.params.id, ownerId: req.ownerId },
    });
    if (!venue) return res.status(404).json({ error: 'Venue not found' });
    const menus = await prisma.menu.findMany({
      where: { venueId: venue.id },
      orderBy: { createdAt: 'asc' },
    });
    res.set('Cache-Control', 'private, max-age=60');
    res.json({ menus });
  } catch (error) {
    console.error('List menus error:', error);
    res.status(500).json({ error: 'Failed to load menus' });
  }
});

// Upload a new menu PDF
router.post('/:id/menus', requireAuth, requireActiveSubscription, upload.single('menu'), async (req, res) => {
  try {
    const venue = await prisma.venue.findFirst({
      where: { id: req.params.id, ownerId: req.ownerId },
    });
    if (!venue) return res.status(404).json({ error: 'Venue not found' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const name = (req.body.name || '').trim() || 'Menu';
    const filename = `${venue.slug}-${Date.now()}.pdf`;
    const { error } = await supabase.storage
      .from('menus')
      .upload(filename, req.file.buffer, { contentType: 'application/pdf', upsert: true });
    if (error) throw error;
    const { data: publicData } = supabase.storage.from('menus').getPublicUrl(filename);

    const menu = await prisma.menu.create({
      data: {
        id: genId(),
        venueId: venue.id,
        name,
        url: publicData.publicUrl,
      },
    });
    res.json({ success: true, menu });
  } catch (error) {
    console.error('Menu upload error:', error);
    if (error.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File too large. Max 20 MB.' });
    if (error.message === 'Only PDF files allowed') return res.status(400).json({ error: 'Only PDF files are allowed.' });
    res.status(500).json({ error: 'Failed to upload menu' });
  }
});

// Rename a menu
router.patch('/:venueId/menus/:menuId', requireAuth, requireActiveSubscription, async (req, res) => {
  try {
    const venue = await prisma.venue.findFirst({
      where: { id: req.params.venueId, ownerId: req.ownerId },
    });
    if (!venue) return res.status(404).json({ error: 'Venue not found' });
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Name required' });

    // Verify menu belongs to this venue
    const existing = await prisma.menu.findFirst({
      where: { id: req.params.menuId, venueId: venue.id },
    });
    if (!existing) return res.status(404).json({ error: 'Menu not found' });

    const menu = await prisma.menu.update({
      where: { id: req.params.menuId },
      data: { name },
    });
    res.json({ success: true, menu });
  } catch (error) {
    console.error('Menu rename error:', error);
    res.status(500).json({ error: 'Failed to rename menu' });
  }
});

// Delete a menu
router.delete('/:venueId/menus/:menuId', requireAuth, requireActiveSubscription, async (req, res) => {
  try {
    const venue = await prisma.venue.findFirst({
      where: { id: req.params.venueId, ownerId: req.ownerId },
    });
    if (!venue) return res.status(404).json({ error: 'Venue not found' });

    // Verify menu belongs to this venue
    const existing = await prisma.menu.findFirst({
      where: { id: req.params.menuId, venueId: venue.id },
    });
    if (!existing) return res.status(404).json({ error: 'Menu not found' });

    // Extract storage filename from the public URL and delete it
    try {
      const url = existing.url;
      const match = url.match(/\/menus\/([^?]+)$/);
      if (match && match[1]) {
        await supabase.storage.from('menus').remove([match[1]]);
      }
    } catch (storageErr) {
      console.error('Storage cleanup failed (continuing with DB delete):', storageErr);
    }

    await prisma.menu.delete({ where: { id: req.params.menuId } });
    res.json({ success: true });
  } catch (error) {
    console.error('Menu delete error:', error);
    res.status(500).json({ error: 'Failed to delete menu' });
  }
});

module.exports = router;
