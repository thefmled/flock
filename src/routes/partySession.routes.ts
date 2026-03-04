import { Router } from 'express';
import * as PartySession from '../controllers/partySession.controller';
import { requireGuestAuth } from '../middleware/auth';

const router = Router();

router.post('/join/:joinToken', PartySession.joinPartySession);
router.get('/:sessionId', requireGuestAuth, PartySession.getPartySessionSummary);
router.get('/:sessionId/participants', requireGuestAuth, PartySession.getPartyParticipants);
router.get('/:sessionId/bucket', requireGuestAuth, PartySession.getPartyBucket);
router.put('/:sessionId/bucket', requireGuestAuth, PartySession.updatePartyBucket);

export default router;
