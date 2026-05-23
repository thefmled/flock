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

// Request OTP
router.post('/request-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const code = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    await prisma.otpCode.create({
      data: {
        id: generateId(),
        phone: email, // reusing phone field for email
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
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ error: 'Email and code required' });

    const otp = await prisma.otpCode.findFirst({
      where: {
        phone: email,
        code,
        consumed: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp) return res.status(400).json({ error: 'Invalid or expired code' });

    await prisma.otpCode.update({
      where: { id: otp.id },
      data: { consumed: true },
    });

    // Find or create owner
    let owner = await prisma.owner.findUnique({ where: { phone: email } });
    let isNewUser = false;

    if (!owner) {
      owner = await prisma.owner.create({
        data: {
          id: generateId(),
          phone: email,
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
