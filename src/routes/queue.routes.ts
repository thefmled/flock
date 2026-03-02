import { Router } from 'express';
import * as Queue from '../controllers/queue.controller';
import { requireAuth, requireGuestAuth, requireRole } from '../middleware/auth';
const router = Router();
router.post('/',                     Queue.joinQueue);         // guest — no auth
router.get ('/live',                 requireAuth, Queue.getVenueQueue);
router.post('/:entryId/session',     Queue.reissueGuestSession);
router.get ('/:entryId',             requireGuestAuth, Queue.getQueueEntry);
router.post('/seat',                 requireAuth, Queue.seatGuest);
router.delete('/:entryId',           requireAuth, requireRole('OWNER','MANAGER','STAFF'), Queue.cancelEntry);
export default router;
