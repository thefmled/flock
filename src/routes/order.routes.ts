import { Router } from 'express';
import * as Order from '../controllers/order.controller';
import { requireAuth, requireGuestAuth, requireGuestOrStaffAuth } from '../middleware/auth';
const router = Router();
router.post('/preorder',     requireGuestAuth, Order.createPreOrder);
router.post('/table/guest',  requireGuestAuth, Order.createGuestTableOrder);
router.post('/table',        requireAuth, Order.createTableOrder);
router.get ('/bill/:queueEntryId', requireGuestOrStaffAuth, Order.getGuestBill);
export default router;
