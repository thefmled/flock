import { Router } from 'express';
import * as Payment from '../controllers/payment.controller';
import { requireAuth, requireGuestAuth, requireRole } from '../middleware/auth';
const router = Router();
// Guest flows
router.post('/deposit/initiate',        requireGuestAuth, Payment.initiateDeposit);
router.post('/deposit/capture',         Payment.captureDeposit);
router.post('/final/initiate',          requireGuestAuth, Payment.initiateFinalPayment);
router.post('/final/capture',           Payment.captureFinalPayment);
router.post('/final/settle-offline',    requireAuth, requireRole('OWNER','MANAGER','STAFF'), Payment.settleFinalOffline);
// Staff flows
router.post('/refund',                  requireAuth, requireRole('OWNER','MANAGER'), Payment.refundDeposit);
// Razorpay webhook — no auth, signature verified inside handler
router.post('/webhook/razorpay',        Payment.razorpayWebhook);
export default router;
