import { env } from './env.js';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
// D-10 / D-ID-08: ioredis 6 must be imported by NAME. Under module:nodenext the
// default export does not resolve to a constructable type.
import { Redis } from 'ioredis';
import { rateLimit } from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import { createLogger } from '@uff/shared/logger';
import { createErrorHandler } from '@uff/shared/errors';
import { createValidateToken } from '@uff/shared/auth';
import { createIdentityProxy, createMediaProxy, createMatchProxy } from './proxies.js';

const logger = createLogger('api-gateway');
const app = express();

// Backs the rate-limit counters, and nothing else — the gateway owns no data.
// Constructed before the middleware chain because `RedisStore` closes over it.
const redisClient = new Redis(env.REDIS_URL);
redisClient.on('connect', () => logger.info('Connected to Redis'));
redisClient.on('error', (err) => logger.error('Error connecting to Redis:', err));

app.use(helmet());
app.use(cors());
app.use(express.json());

/**
 * Registered BEFORE the rate limiter on purpose (D-GW-05). The limiter is global and
 * allows 100 requests per IP per 15 minutes; a compose/orchestrator health probe
 * every 10s is 90 of those on its own, so behind the limiter the probe would start
 * returning 429 and mark a perfectly healthy gateway as unhealthy.
 *
 * Reports Redis reachability only. Redis being down does not stop the gateway
 * proxying, but it does break rate limiting, which is a degraded state worth
 * surfacing. The gateway has no database and no message bus to report on.
 */
app.get('/health', (_req, res) => {
  const redisReady = redisClient.status === 'ready';
  res.status(redisReady ? 200 : 503).json({
    service: 'api-gateway',
    status: redisReady ? 'ok' : 'degraded',
    redis: redisClient.status,
  });
});

/**
 * The only ACTIVE rate limiter in the system — the other four services have theirs
 * commented out. Counters live in Redis so replicas of the gateway share one budget
 * rather than each granting the full 100.
 *
 * Applied globally, which includes `/v1/auth/login`: credential endpoints get the
 * same generous bucket as everything else. Preserved; issue 3.
 */
const ratelimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(`Sensitive endpoint rate limit exceeded for ip: ${req.ip}`);
    res.status(429).json({ message: 'Too many requests, please try again later.' });
  },
  store: new RedisStore({
    // `call` is variadic in ioredis but its overloads require a non-empty tuple,
    // which a `string[]` rest parameter cannot satisfy — hence the (command, args)
    // form. The cast narrows ioredis's `Promise<unknown>` to the reply union the
    // store declares; the values are the same, only the declared type differs.
    sendCommand: (...args: string[]) =>
      redisClient.call(args[0], args.slice(1)) as Promise<RedisReply>,
  }),
});

app.use(ratelimit);

app.use((req, _res, next) => {
  logger.info(`  Recieved ${req.method} Request to  ${req.url}`);
  // A template literal, not a serialisation: prints "[object Object]" whenever
  // express.json() parsed a body, and "undefined" for bodyless requests. Preserved
  // verbatim (issue 4) — serialising it properly would start writing plaintext
  // passwords from /v1/auth/login into the logs, so the defect is what keeps them out.
  logger.info(`Request Body ${req.body}`);
  next();
});

// Preserved in its original position, which is AFTER the rate limiter (issue 1).
// express-rate-limit reads this setting when it keys on `req.ip`, so registering it
// late is a live bug behind a load balancer. Moving it is a behaviour change and
// belongs with the rate-limiting rework, not with the port (D-GW-06).
app.set('trust proxy', 1);

// The single point in the entire system where a JWT signature is verified. Everything
// downstream trusts the `x-team-id` header this produces (backlog item 1).
const validateToken = createValidateToken(env.JWT_SECRET, logger);

app.use('/v1/auth', createIdentityProxy(env.IDENTITY_SERVICE_URL, logger));
app.use('/v1/media', validateToken, createMediaProxy(env.MEDIA_SERVICE_URL, logger));
app.use('/v1/match', validateToken, createMatchProxy(env.MATCH_SERVICE_URL, logger));

// Registered last, after all routes. Express 5 funnels async rejections here
// automatically, which Express 4 did not.
app.use(createErrorHandler(logger));

/**
 * The gateway has no datastore to connect to before it can serve traffic — the Redis
 * client connects in the background and the proxies are stateless — so unlike
 * identity-service there is nothing to await before `listen`. The wrapper exists for
 * the shutdown wiring, which needs the server handle.
 */
function startServer(): void {
  const server = app.listen(env.PORT, () => {
    logger.info(`API Gateway is running on port ${env.PORT}`);
    logger.info(`Identity Service URL:, ${env.IDENTITY_SERVICE_URL}`);
    logger.info(`Media Service URL ${env.MEDIA_SERVICE_URL}`);
    logger.info(`Match Service URL ${env.MATCH_SERVICE_URL}`);
    logger.info(`Redis URL:', ${env.REDIS_URL}`);
  });

  /**
   * Graceful shutdown. Stops accepting new connections, lets in-flight proxied
   * requests finish, then drops Redis. The gateway is the public edge, so exiting
   * before `close` resolves would sever real client requests mid-response — which is
   * why the exit happens inside the callback rather than after it.
   */
  const shutdown = (signal: string): void => {
    logger.info(`${signal} received, shutting down`);
    server.close(() => {
      logger.info('HTTP server closed');
      redisClient.disconnect();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer();

// Neither handler existed in the original gateway; both match identity-service.
// Logging without exiting is deliberate — it mirrors the reference port, where the
// behaviour was inherited rather than chosen. Backlog item 12.
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception, exiting:', err);
  process.exit(1);
});
