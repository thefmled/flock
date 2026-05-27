const express = require('express');

const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const { updateSubscriptionQuantity } = require('./subscription');

const upload = multer({ storage: multer.memoryStorage() });
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
    const { name, address, floorManagerName, menuPdfUrl, googleReviewsUrl } = req.body;

    if (!name || !address || !floorManagerName) {
      return res.status(400).json({ error: 'Name, address, and floor manager name are required' });
    }

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
        menuPdfUrl: menuPdfUrl || null,
        googleReviewsUrl: googleReviewsUrl || null,
        seatingOptions: seatingOptions || 'Indoor,Outdoor,No preference',
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
    });
    if (!venue) return res.status(404).json({ error: 'Venue not found' });
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

    await prisma.venue.delete({ where: { id: venue.id } });
    const count = await prisma.venue.count({ where: { ownerId: req.ownerId } });
    await updateSubscriptionQuantity(req.ownerId, count);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete venue error:', error);
    res.status(500).json({ error: 'Failed to delete venue' });
  }
});

// Update a venue
router.patch('/:id', requireAuth, requireActiveSubscription, async (req, res) => {
  try {
    const venue = await prisma.venue.findFirst({
      where: { id: req.params.id, ownerId: req.ownerId },
    });
    if (!venue) return res.status(404).json({ error: 'Venue not found' });

    const allowed = ['name', 'address', 'floorManagerName', 'menuPdfUrl', 'googleReviewsUrl', 'seatingOptions', 'noteOptions', 'waitTimeBase', 'waitTimeIncrement', 'waitTimeCap', 'theme'];
    const data = {};
    for (const key of allowed) {
      if (key in req.body) data[key] = req.body[key];
    }

    const updated = await prisma.venue.update({
      where: { id: venue.id },
      data,
    });
    res.json({ success: true, venue: updated });
  } catch (error) {
    console.error('Update venue error:', error);
    res.status(500).json({ error: 'Failed to update venue' });
  }
});

// Upload menu PDF for a venue
router.post('/:id/menu', requireAuth, requireActiveSubscription, upload.single('menu'), async (req, res) => {
  try {
    const venue = await prisma.venue.findFirst({
      where: { id: req.params.id, ownerId: req.ownerId },
    });
    if (!venue) return res.status(404).json({ error: 'Venue not found' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (req.file.mimetype !== 'application/pdf') {
      return res.status(400).json({ error: 'Only PDF files are allowed' });
    }

    const filename = `${venue.slug}-${Date.now()}.pdf`;
    const { data, error } = await supabase.storage
      .from('menus')
      .upload(filename, req.file.buffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (error) throw error;

    const { data: publicData } = supabase.storage.from('menus').getPublicUrl(filename);
    const menuPdfUrl = publicData.publicUrl;

    const updated = await prisma.venue.update({
      where: { id: venue.id },
      data: { menuPdfUrl },
    });

    res.json({ success: true, venue: updated });
  } catch (error) {
    console.error('Menu upload error:', error);
    res.status(500).json({ error: 'Failed to upload menu' });
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

module.exports = router;
