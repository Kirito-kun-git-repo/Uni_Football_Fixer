import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import type { Logger } from './logger.js';

/**
 * What lands on `req.team`.
 *
 * At the gateway this is the decoded JWT payload. Downstream it is reconstructed
 * from the `x-team-id` header the gateway injected, so only `teamId` is populated.
 *
 * `name` is present because the gateway's JWT carries it — but it is ALWAYS
 * undefined, because `generateToken` signs `team.name` while the Team model's field
 * is `teamName`. Preserved as-is; backlog item 5.
 */
export interface AuthenticatedTeam {
  teamId: string;
  name?: string;
}

declare global {
  namespace Express {
    interface Request {
      team?: AuthenticatedTeam;
    }
  }
}

/**
 * Gateway-only. The single place in the whole system where a JWT is actually
 * verified. On success the decoded payload is attached to `req.team`, and the proxy
 * layer forwards `req.team.teamId` downstream as the `x-team-id` header.
 */
export function createValidateToken(secret: string, logger: Logger): RequestHandler {
  return (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      logger.warn('Access attempted without valid token');
      res.status(401).json({ message: 'Authentication required ! Please Login to continue' });
      return;
    }

    jwt.verify(token, secret, (err, decoded) => {
      if (err) {
        logger.error('Token validation failed:', err);
        res.status(403).json({ message: 'Invalid token' });
        return;
      }
      req.team = decoded as AuthenticatedTeam;
      next();
    });
  };
}

/**
 * Downstream services. Reads the `x-team-id` header the gateway injected and trusts
 * it unconditionally — no signature, no shared secret, no verification of any kind.
 *
 * This is an authentication bypass for anyone who can reach a service port directly.
 * It is preserved deliberately: fixing it requires a coordinated change across the
 * gateway and all four downstream services, which is out of scope for this migration.
 * Backlog item 1.
 */
export function createAuthenticateRequest(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const teamId = req.headers['x-team-id'];

    if (!teamId || typeof teamId !== 'string') {
      logger.warn('Access attempted without team ID');
      res.status(401).json({ message: 'Authentication required ! Please Login to continue' });
      return;
    }

    req.team = { teamId };
    logger.info(`User authenticated with ID: ${teamId}`);
    next();
  };
}
