import { Router } from 'express';
import * as Queue from '../controllers/queue.controller';
import { requireAuth, requireGuestAuth, requireRole } from '../middleware/auth';
import { guestPollReadLimiter, operatorReadLimiter, operatorWriteLimiter, otpVerifyLimiter } from '../middleware/rateLimiter';
const router = Router();
router.post('/',                     Queue.joinQueue);         // guest — no auth
router.get ('/live',                 requireAuth, operatorReadLimiter, Queue.getVenueQueue);
router.post('/:entryId/session',     otpVerifyLimiter, Queue.reissueGuestSession);
router.get ('/:entryId',             requireGuestAuth, guestPollReadLimiter, Queue.getQueueEntry);
router.post('/seat',                 requireAuth, operatorWriteLimiter, Queue.seatGuest);
router.delete('/:entryId',           requireAuth, requireRole('OWNER','MANAGER','STAFF'), operatorWriteLimiter, Queue.cancelEntry);
router.post  ('/:entryId/checkout',  requireAuth, requireRole('OWNER','MANAGER','STAFF'), operatorWriteLimiter, Queue.checkoutEntry);
router.get   ('/history/recent',      requireAuth, requireRole('OWNER','MANAGER'), operatorReadLimiter, Queue.getRecentHistory);
router.get   ('/:entryId/flow',      requireAuth, requireRole('OWNER','MANAGER'), operatorReadLimiter, Queue.getEntryFlowEvents);
export default router;
