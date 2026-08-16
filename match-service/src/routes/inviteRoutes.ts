import { Router } from 'express';
import type { Logger } from '@uff/shared/logger';
import { createInviteController } from '../controllers/match-Invite-Controller.js';

/**
 * Mounted at `/api/match` by server.ts — the SAME prefix as matchRoutes, and
 * registered first so these paths are matched before `matchRoutes`' `GET /:id`
 * catch-all.
 */
export function createInviteRouter(logger: Logger): Router {
  const router = Router();
  const controller = createInviteController(logger);

  logger.info('Invites routes loaded');
  router.post('/send-invite/:matchId', controller.createInvite);
  router.post('/respond-to-invites/:inviteId', controller.respondToInvite);
  router.get('/get-all-invites/', controller.getIncomingInvites);
  router.get('/get-outgoing-invites/', controller.getOutgoingInvites);

  return router;
}
