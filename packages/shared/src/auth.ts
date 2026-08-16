import crypto from 'node:crypto';
import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import type { Logger } from './logger.js';

/**
 * Constant-time comparison. A plain `!==` on a secret leaks its prefix through
 * response timing; with public service URLs that is a practical attack, not a
 * theoretical one.
 *
 * `timingSafeEqual` throws on length mismatch, which would itself leak length, so
 * both sides are hashed to a fixed 32 bytes first.
 */
function secretsMatch(provided: string, expected: string): boolean {
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

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
 * Downstream services. Reads the `x-team-id` header the gateway injected.
 *
 * `x-team-id` alone is NOT authentication — it is an unsigned assertion of identity.
 * Whether that is safe depends entirely on whether the caller could have reached this
 * service without passing through the gateway. Under docker-compose the answer is no,
 * because the service publishes no host port (D-12). On a platform where every service
 * gets its own public URL, the answer is yes, and the header alone means anyone can
 * impersonate any team with a single curl.
 *
 * `internalSecret` closes that. When supplied, a request must also carry a matching
 * `x-internal-secret` header, which only the gateway knows how to add. Callers that
 * bypass the gateway are rejected before `x-team-id` is even read.
 *
 * When it is NOT supplied the behaviour is exactly as before — deliberately, so that
 * a compose or single-host deployment, where network topology already provides the
 * guarantee, keeps working without configuration. Set it whenever a service is
 * reachable from outside; leave it unset when it demonstrably is not.
 *
 * This is the fix for backlog A-1's impersonation half.
 */
export function createAuthenticateRequest(
  logger: Logger,
  internalSecret?: string,
): RequestHandler {
  if (!internalSecret) {
    logger.warn(
      'INTERNAL_SECRET is not set — this service trusts the x-team-id header from any ' +
        'caller. Safe only if it cannot be reached without passing through the gateway.',
    );
  }

  return (req, res, next) => {
    if (internalSecret) {
      const provided = req.headers['x-internal-secret'];
      if (typeof provided !== 'string' || !secretsMatch(provided, internalSecret)) {
        // Deliberately terse and identical to the missing-team-id response: a caller
        // probing directly should not learn whether the secret is the thing that failed.
        logger.warn('Rejected a request that did not come through the gateway');
        res.status(401).json({ message: 'Authentication required ! Please Login to continue' });
        return;
      }
    }

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
