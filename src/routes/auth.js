const express = require('express');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const { sendOtpEmail } = require('../lib/email');

const router = express.Router();

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateId() {
  return 'c' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// In-memory rate limiters. Each entry: { count, windowStart, lockedUntil? }
const requestRate = new Map();  // email -> request-otp tracking
const verifyRate = new Map();   // email -> verify-otp tracking
const REQUEST_MIN_INTERVAL_MS = 30 * 1000;   // 1 request per 30s
const REQUEST_HOUR_CAP = 5;                  // 5 requests per hour
const VERIFY_MAX_ATTEMPTS = 5;               // 5 wrong codes
const VERIFY_LOCK_MS = 10 * 60 * 1000;       // 10 min lockout

// Periodic cleanup
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of requestRate) {
    if (now - v.windowStart > 60 * 60 * 1000 && (!v.lastAt || now - v.lastAt > 60 * 60 * 1000)) requestRate.delete(k);
  }
  for (const [k, v] of verifyRate) {
    if (v.lockedUntil && now > v.lockedUntil) verifyRate.delete(k);
    else if (!v.lockedUntil && now - v.windowStart > 60 * 60 * 1000) verifyRate.delete(k);
  }
}, 5 * 60 * 1000);

// Periodic OtpCode cleanup, codes expire in minutes but rows are never removed,
// so purge anything older than 7 days to keep the table from growing unbounded.
async function cleanupOldOtpCodes() {
  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const { count } = await prisma.otpCode.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    if (count > 0) console.log(`Cleaned up ${count} expired OTP codes`);
  } catch (e) {
    console.error('OTP cleanup error:', e);
  }
}
setInterval(cleanupOldOtpCodes, 6 * 60 * 60 * 1000); // every 6 hours
cleanupOldOtpCodes(); // run once at startup

// Request OTP
router.post('/request-otp', async (req, res) => {
  try {
    const { email: rawEmail } = req.body;
    if (!rawEmail) return res.status(400).json({ error: 'Email is required' });
    const email = rawEmail.trim().toLowerCase();

    // Rate limit: 1 request per 30s and max 5 per hour per email
    const key = email;
    const now = Date.now();
    const rec = requestRate.get(key) || { count: 0, windowStart: now, lastAt: 0 };
    if (rec.lastAt && now - rec.lastAt < REQUEST_MIN_INTERVAL_MS) {
      const waitSec = Math.ceil((REQUEST_MIN_INTERVAL_MS - (now - rec.lastAt)) / 1000);
      return res.status(429).json({ error: `Please wait ${waitSec}s before requesting another code.` });
    }
    if (now - rec.windowStart > 60 * 60 * 1000) {
      rec.count = 0;
      rec.windowStart = now;
    }
    if (rec.count >= REQUEST_HOUR_CAP) {
      return res.status(429).json({ error: 'Too many code requests. Please try again in an hour.' });
    }
    rec.count++;
    rec.lastAt = now;
    requestRate.set(key, rec);

    const code = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    await prisma.otpCode.create({
      data: {
        id: generateId(),
        email,
        code,
        expiresAt,
      },
    });

    await sendOtpEmail(email, code);
    res.json({ success: true, message: 'OTP sent' });
  } catch (error) {
    console.error('Request OTP error:', error);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// Verify OTP
router.post('/verify-otp', async (req, res) => {
  try {
    const { email: rawEmail, code } = req.body;
    if (!rawEmail || !code) return res.status(400).json({ error: 'Email and code required' });
    const email = rawEmail.trim().toLowerCase();

    // Rate limit: 5 wrong attempts then 10-min lock per email
    const key = email;
    const now = Date.now();
    const vrec = verifyRate.get(key) || { count: 0, windowStart: now };
    if (vrec.lockedUntil && now < vrec.lockedUntil) {
      const waitMin = Math.ceil((vrec.lockedUntil - now) / 60000);
      return res.status(429).json({ error: `Too many attempts. Try again in ${waitMin} min.` });
    }

    const otp = await prisma.otpCode.findFirst({
      where: {
        email,
        code,
        consumed: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp) {
      vrec.count++;
      if (vrec.count >= VERIFY_MAX_ATTEMPTS) {
        vrec.lockedUntil = now + VERIFY_LOCK_MS;
      }
      verifyRate.set(key, vrec);
      return res.status(400).json({ error: 'Invalid or expired code' });
    }
    // Success, clear rate state
    verifyRate.delete(key);

    await prisma.otpCode.update({
      where: { id: otp.id },
      data: { consumed: true },
    });

    // Find or create owner
    let owner = await prisma.owner.findUnique({ where: { email } });
    let isNewUser = false;

    if (!owner) {
      owner = await prisma.owner.create({
        data: {
          id: generateId(),
          email,
        },
      });
      isNewUser = true;
    }

    const token = jwt.sign(
      { ownerId: owner.id, email },
      process.env.JWT_SECRET,
      { expiresIn: '90d' }
    );

    res.json({ success: true, token, isNewUser, owner });
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({ error: 'Failed to verify OTP' });
  }
});

module.exports = router;
