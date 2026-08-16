import { env } from './env.js';
import express from 'express';
import mongoose from 'mongoose';
import helmet from 'helmet';
import cors from 'cors';
import { createClient } from 'redis';
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { createLogger } from '@uff/shared/logger';
import { createErrorHandler } from '@uff/shared/errors';
import { connectToRabbitMQ, closeRabbitMQ } from '@uff/shared/rabbitmq';
import { createMediaRouter } from './routes/media-routes.js';

const logger = createLogger('media-service');
const app = express();

// Middleware order is preserved from the original: cors BEFORE helmet, which is the
// reverse of identity-service. Left as-is under the behaviour-preserving rule.
app.use(cors());
app.use(helmet());
app.use(express.json());
app.use((req, _res, next) => {
  logger.info(`  Recieved ${req.method} Request to  ${req.url}`);
  // Preserved; see D-MD-07. In practice this always prints "Request Body undefined": Express 5
  // leaves `req.body` undefined unless a parser populated it, and neither route feeds
  // `express.json()` — `/get` has no body and `/upload-logo` is multipart, which multer parses
  // only after this middleware has run. The "[object Object]" form the original was written
  // against needs a JSON-bodied route, and this service has none.
  logger.info(`Request Body ${req.body}`);
  next();
});

/**
 * Liveness + readiness. docker-compose health-checks this, and it is the only way to
 * know the service came up cleanly. Registered before the rate limiter's mount path so
 * an orchestrator's probe can never be 429'd.
 */
app.get('/health', (_req, res) => {
  const mongoReady = mongoose.connection.readyState === 1;
  res.status(mongoReady ? 200 : 503).json({
    service: 'media-service',
    status: mongoReady ? 'ok' : 'degraded',
    mongo: mongoose.connection.readyState,
  });
});

/**
 * D-MD-01: this is the only service in the system whose rate limiter is actually
 * mounted, so `redis` (node-redis) is kept rather than swapped for ioredis — the store
 * below is the single consumer of the client, and node-redis's `sendCommand(args)`
 * shape is what `rate-limit-redis` is wired to here.
 */
const redisClient = createClient({ url: env.REDIS_URL });
redisClient.on('connect', () => {
  logger.info('Connected to Redis');
});
redisClient.on('error', (err) => {
  logger.error('Redis error:', err);
});

/**
 * D-MD-08: connected HERE, at module scope with a top-level await, rather than inside
 * `startServer()` alongside Mongo and RabbitMQ.
 *
 * `rateLimit()` calls `store.init()` synchronously during construction, and
 * `rate-limit-redis` caches the resulting `SCRIPT LOAD` promise in
 * `incrementScriptSha` — permanently. If the client is not connected by then, that
 * cached promise is a rejection, and every later request to `/api/media` rethrows it:
 * the limiter fails closed forever, with no retry. Connecting first is what makes the
 * store's one-shot initialisation succeed.
 */
try {
  await redisClient.connect();
} catch (error) {
  logger.error('Error connecting to Redis:', error);
  process.exit(1);
}

// Mirrors `rate-limit-redis`'s own `RedisReply`, which the package does not export.
// Naming it explicitly is what keeps `sendCommand`'s generic off `any`.
type RedisReply = boolean | number | string | Array<boolean | number | string>;

const sensitiveRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  limit: 50,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(`Rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({ message: 'Too many requests, please try again later.' });
  },
  store: new RedisStore({
    sendCommand: (...args: string[]) => redisClient.sendCommand<RedisReply>(args),
  }),
});

// routes
app.use('/api/media', sensitiveRateLimiter);
app.use('/api/media', createMediaRouter(logger));

// Registered last, after all routes. Express 5 funnels async rejections here
// automatically, which Express 4 did not.
app.use(createErrorHandler(logger));

/**
 * Startup order matters: Redis (above) -> Mongo -> RabbitMQ -> HTTP listener.
 * The listener starts LAST so the container never accepts traffic it cannot service.
 *
 * The original awaited none of these — `mongoose.connect` and `redisClient.connect()`
 * were both fire-and-forget, so early requests could reach the rate limiter before its
 * store had a connection (issue 6). Awaiting them is D-MD-08.
 */
async function startServer(): Promise<void> {
  try {
    await mongoose.connect(env.MONGODB_URL);
    logger.info('Connected to MongoDB');

    // Publisher only — this service registers no consumers. The `post.deleted`
    // subscription in the original was commented out and its handler module was
    // empty; both are gone (D-MD-04).
    await connectToRabbitMQ(env.RABBITMQ_URL, logger);
    logger.info('RabbitMQ connection established successfully');

    const server = app.listen(env.PORT, () => {
      logger.info(`Media service is running on port ${env.PORT}`);
    });

    /**
     * Graceful shutdown. Stops accepting connections, then closes the bus and the
     * datastores. Without this, a deploy severs in-flight uploads and leaks the
     * RabbitMQ channel.
     */
    const shutdown = async (signal: string): Promise<void> => {
      logger.info(`${signal} received, shutting down`);
      server.close(() => logger.info('HTTP server closed'));
      await closeRabbitMQ();
      await mongoose.connection.close();
      await redisClient.close();
      process.exit(0);
    };

    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
  } catch (error) {
    logger.error('Error starting server:', error);
    process.exit(1);
  }
}

void startServer();

// Preserved from the original: logs but does not exit.
process.on('unhandledRejection', (error) => {
  logger.error('Unhandled Rejection:', error);
});

// New: the original had no uncaughtException handler at all, so a synchronous throw
// outside a request left the process running in an undefined state.
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception, exiting:', err);
  process.exit(1);
});
