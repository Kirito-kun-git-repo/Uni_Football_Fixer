import { Router } from 'express';
import type { Logger } from '@uff/shared/logger';
import { createMatchController } from '../controllers/match-Controller.js';

/**
 * Mounted at `/api/match` by server.ts, AFTER the invite router. The order matters:
 * `GET /:id` below is a catch-all that would otherwise swallow every invite GET, so
 * `inviteRoutes` has to win the match first. Issue 16.
 *
 * The gateway rewrites `/v1/match/*` to `/api/match/*`.
 */
export function createMatchRouter(logger: Logger): Router {
  const router = Router();
  const controller = createMatchController(logger);

  router.post('/create-match', controller.createMatch);
  router.get('/get-matches', controller.getAllMatches);
  router.get('/get-my-matches/', controller.getMyMatches);
  router.get('/:id', controller.getMatchById);

  return router;
}
