import type { Request, RequestHandler } from 'express';
import type { OutgoingHttpHeaders } from 'node:http';
import proxy from 'express-http-proxy';
import type { Logger } from '@uff/shared/logger';

/**
 * Mutates the outbound header set in place. One of these per downstream service —
 * the header injection is the only thing the three proxies do differently, so it is
 * the only thing passed in (D-GW-03).
 */
type HeaderDecorator = (headers: OutgoingHttpHeaders, srcReq: Request) => void;

/**
 * Builds one reverse proxy. Called three times from `server.ts`, once per downstream
 * service, and the returned handler is mounted under its `/v1/*` prefix.
 *
 * Everything except `decorateHeaders` was already identical across the three original
 * proxy blocks: the same `proxyOptions` object was spread into all of them, and each
 * `userResDecorator` differed only in the service name it logged.
 */
function createServiceProxy(
  serviceName: string,
  target: string,
  logger: Logger,
  decorateHeaders: HeaderDecorator,
  internalSecret?: string,
): RequestHandler {
  return proxy(target, {
    // The gateway's entire routing contract: the public `/v1` prefix becomes the
    // internal `/api` prefix. Every downstream service mounts its router at `/api/*`
    // and none of them know the `/v1` prefix exists.
    proxyReqPathResolver: (req) => req.originalUrl.replace(/^\/v1/, '/api'),

    // Transport-level failures only (target unreachable, socket reset). Collapses
    // every cause to a flat 500 — the upstream status is not preserved. Preserved
    // from the original; issue 5 in docs/architecture/01-api-gateway.md.
    proxyErrorHandler: (err: Error, res, _next) => {
      logger.error(`Proxy error: ${err.message}`);
      res.status(500).json({ message: 'Internal Server Error' });
    },

    proxyReqOptDecorator: (proxyReqOpts, srcReq) => {
      decorateHeaders(proxyReqOpts.headers, srcReq);

      /**
       * Proof that this request came through the gateway.
       *
       * Injected here rather than in each `decorateHeaders` so it cannot be forgotten
       * on a future proxy — every service the gateway fronts gets it automatically.
       * Downstream, `createAuthenticateRequest` rejects anything without it, which is
       * what makes `x-team-id` safe to trust when the services have public URLs.
       *
       * Note this header is ADDED to the outbound request only. A client that sends
       * its own `x-internal-secret` cannot benefit: it is overwritten here, and a
       * request that skips the gateway never reaches this code at all.
       */
      if (internalSecret && proxyReqOpts.headers) {
        proxyReqOpts.headers['x-internal-secret'] = internalSecret;
      }
      return proxyReqOpts;
    },

    // Buffers the whole response body to log its status code, then returns it
    // verbatim. Preserved from the original; issue 12 — large media responses are
    // fully materialised in gateway memory.
    userResDecorator: (proxyRes, proxyResData) => {
      logger.info(`Received response from ${serviceName} service : ${proxyRes.statusCode}`);
      return proxyResData;
    },
  });
}

/**
 * `/v1/auth/*` -> identity-service. Mounted WITHOUT `validateToken`: this is where
 * tokens are issued, so requiring one would make login unreachable. It also means
 * `GET /v1/auth/getTeamById/:teamId` is public — preserved, backlog item 1.
 */
export function createIdentityProxy(
  target: string,
  logger: Logger,
  internalSecret?: string,
): RequestHandler {
  return createServiceProxy(
    'identity',
    target,
    logger,
    (headers) => {
      headers['Content-Type'] = 'application/json';
    },
    internalSecret,
  );
}

/**
 * `/v1/media/*` -> media-service. Mounted behind `validateToken`.
 *
 * The Content-Type check is what makes uploads work: media-service parses
 * `multipart/form-data` with multer, and overwriting the boundary-carrying header
 * with `application/json` would make every upload unparseable.
 */
export function createMediaProxy(
  target: string,
  logger: Logger,
  internalSecret?: string,
): RequestHandler {
  return createServiceProxy(
    'media',
    target,
    logger,
    (headers, srcReq) => {
      // `validateToken` runs before this handler and 401s without it, so `team` is
      // always populated here. The assertion documents that ordering dependency.
      headers['x-team-id'] = srcReq.team!.teamId;

      // D-GW-04: the original called `.startsWith()` on the raw header, which is
      // `undefined` on any request without a body — every GET and DELETE to
      // /v1/media/* threw a TypeError before reaching the upstream. The optional
      // chain makes a missing Content-Type behave like a non-multipart request.
      if (!(srcReq.headers['content-type']?.startsWith('multipart/form-data') ?? false)) {
        headers['Content-Type'] = 'application/json';
      }
    },
    internalSecret,
  );
}

/**
 * `/v1/match/*` -> match-service. Mounted behind `validateToken`.
 */
export function createMatchProxy(
  target: string,
  logger: Logger,
  internalSecret?: string,
): RequestHandler {
  return createServiceProxy(
    'match',
    target,
    logger,
    (headers, srcReq) => {
      headers['x-team-id'] = srcReq.team!.teamId;
      logger.info(srcReq.team!.teamId);
      headers['Content-Type'] = 'application/json';
    },
    internalSecret,
  );
}
