import { Router } from 'express';
import type { Logger } from '@uff/shared/logger';
import { createIdentityController } from '../controllers/identity-controller.js';

/**
 * Mounted at `/api/auth` by server.ts. The gateway rewrites `/v1/auth/*` to
 * `/api/auth/*` and — unlike every other proxied route — does NOT apply
 * `validateToken`, because these endpoints are how a token is obtained in the
 * first place.
 */
export function createIdentityRouter(logger: Logger): Router {
  const router = Router();
  const controller = createIdentityController(logger);

  router.post('/register', controller.registration);
  router.post('/login', controller.loginUser);
  router.post('/refresh-token', controller.refreshTokenUser);
  router.post('/logout', controller.logoutUser);
  router.get('/getTeamById/:teamId', controller.getTeamById);

  return router;
}
