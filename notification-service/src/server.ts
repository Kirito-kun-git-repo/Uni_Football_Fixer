import { env } from './env.js';
import express from 'express';
import mongoose from 'mongoose';
import helmet from 'helmet';
import cors from 'cors';
// D-10 / D-ID-08: ioredis 6 must be imported by NAME. Under module:nodenext the
// default export does not resolve to a constructable type.
import { Redis } from 'ioredis';
import { createLogger } from '@uff/shared/logger';
import { createErrorHandler } from '@uff/shared/errors';
import { createAuthenticateRequest } from '@uff/shared/auth';
import { connectToRabbitMQ, consumeEvent, closeRabbitMQ } from '@uff/shared/rabbitmq';
import { createMailer } from './utils/mailer.js';
import { createNotificationService } from './services/notificationService.js';

const logger = createLogger('notification-service');
const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use((req, _res, next) => {
  // Both lines preserved verbatim from the original, misspelling and stray spacing
  // included. `${req.body}` stringifies to "[object Object]" — it has never logged a
  // usable body. Kept because the port changes language, not output.
  logger.info(`  Recieved ${req.method} Request to  ${req.url}`);
  logger.info(`Request Body ${req.body}`);
  next();
});

/**
 * Liveness + readiness. New in the port — this service previously exposed nothing at
 * all. docker-compose health-checks it, and it is the only externally observable
 * signal that a service with no API actually came up.
 *
 * Registered BEFORE `authenticateRequest` below, deliberately: the health probe has
 * no `x-team-id` header to send and would otherwise get a 401.
 */
app.get('/health', (_req, res) => {
  const mongoReady = mongoose.connection.readyState === 1;
  res.status(mongoReady ? 200 : 503).json({
    service: 'notification-service',
    status: mongoReady ? 'ok' : 'degraded',
    mongo: mongoose.connection.readyState,
  });
});

/**
 * D-NT-02: mounted globally with ZERO routes behind it, exactly as in the original.
 *
 * This service has no API and is not registered in the gateway, so nothing legitimate
 * ever passes through here. Its only observable effect is that any unknown path
 * answers 401 instead of 404. Kept rather than deleted so that response stays the
 * same; see DECISIONS.md for why deleting it was rejected.
 */
app.use(createAuthenticateRequest(logger, env.INTERNAL_SECRET));

// Registered last, after every route. Express 5 funnels async rejections here.
app.use(createErrorHandler(logger));

/**
 * D-NT-03: nothing in this service reads Redis. It existed only to back the
 * `RateLimiterRedis` that was never applied to a route, and that limiter is gone.
 * The client is kept for parity with identity-service and for the connect/error log
 * lines the original emitted.
 */
const redisClient = new Redis(env.REDIS_URL);
redisClient.on('connect', () => logger.info('Connected to Redis'));
redisClient.on('error', (err) => logger.error('Error connecting to Redis:', err));

/**
 * Startup order: Mongo -> RabbitMQ -> mailer -> consumer -> HTTP listener.
 *
 * The original did not await the Mongo connection at all — it was a floating
 * `.then()` at module scope, so the consumer could start handling events before the
 * database was reachable. Awaiting it here matches identity-service (D-NT-05).
 *
 * The listener starts LAST so the health probe cannot report ready before the bus
 * subscription exists.
 */
async function startServer(): Promise<void> {
  try {
    await mongoose.connect(env.MONGODB_URL);
    logger.info('Connected to MongoDB');

    await connectToRabbitMQ(env.RABBITMQ_URL, logger);
    logger.info('RabbitMQ connection established successfully');

    const mailer = createMailer();
    const handlers = createNotificationService(logger, mailer);

    /**
     * The service's entire reason to exist: one queue, one routing key.
     *
     * `notification.notification` is `<service>.<routingKey>` — a named durable queue
     * shared by every replica, which is what stops two instances from each sending
     * every email (D-05). Before the port this was an anonymous exclusive queue.
     *
     * `event.purpose` is the whole contract with match-service. The `default` branch
     * is not defensive padding: match-service's synchronous invite path publishes
     * with `purpose` omitted entirely, so real invite traffic lands there and is
     * warned about rather than sent. Backlog item 2 — preserved exactly.
     */
    await consumeEvent('notification.notification', 'notification', async (event) => {
      try {
        logger.info('Received event:', event);

        switch (event.purpose) {
          case 'invite':
            await handlers.handleInvite(event);
            break;
          case 'match.fixed':
            await handlers.handleMatchFixed(event);
            break;
          default:
            logger.warn('Unknown notification purpose:', event.purpose);
        }
      } catch (err) {
        // `catch` binds `unknown` under strict; the original read `.message` and
        // `.stack` off whatever was thrown, which is what these two reads reproduce.
        const error = err as Error;
        logger.error('Error handling notification event:', {
          error: error.message || err,
          stack: error.stack,
        });
      }
    });

    const server = app.listen(env.PORT, () => {
      logger.info(`notification-service is running on port ${env.PORT}`);
    });

    /**
     * Graceful shutdown — new in the port. Without it a deploy severs the RabbitMQ
     * channel mid-delivery, which with the now-durable queue means the message is
     * redelivered and the email is sent twice (there is no idempotency key —
     * backlog item 8).
     */
    const shutdown = async (signal: string): Promise<void> => {
      logger.info(`${signal} received, shutting down`);
      server.close(() => logger.info('HTTP server closed'));
      await closeRabbitMQ();
      await mongoose.connection.close();
      redisClient.disconnect();
      process.exit(0);
    };

    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
  } catch (err) {
    logger.error('Error starting server:', err);
    process.exit(1);
  }
}

void startServer();

// Preserved from the original: logs but does not exit.
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', promise, 'reason:', reason);
});

// New: the original had no uncaughtException handler, so a synchronous throw outside
// a request left the process alive in an undefined state.
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception, exiting:', err);
  process.exit(1);
});
