import { env } from './env.js';
import express from 'express';
import mongoose from 'mongoose';
import helmet from 'helmet';
import cors from 'cors';
// D-10: ioredis 6 must be imported by NAME. Under module:nodenext the default
// export does not resolve to a constructable type (`new Redis(...)` fails to
// compile). This applies to every service that touches Redis.
import { Redis } from 'ioredis';
import { createLogger } from '@uff/shared/logger';
import { createErrorHandler } from '@uff/shared/errors';
import { connectToRabbitMQ, consumeEvent, closeRabbitMQ } from '@uff/shared/rabbitmq';
import { createIdentityRouter } from './routes/identity-routes.js';
import { createEventHandlers } from './eventHandlers/identity-event-handlers.js';

const logger = createLogger('identity-service');
const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use((req, _res, next) => {
  logger.info(`Received ${req.method} Request to ${req.url}`);
  next();
});

/**
 * Liveness + readiness. docker-compose health-checks this, and the gateway's
 * `depends_on` gates on it — it is the only way to know the service came up cleanly.
 * The project previously had no probe of any kind.
 */
app.get('/health', (_req, res) => {
  const mongoReady = mongoose.connection.readyState === 1;
  res.status(mongoReady ? 200 : 503).json({
    service: 'identity-service',
    status: mongoReady ? 'ok' : 'degraded',
    mongo: mongoose.connection.readyState,
  });
});

app.use('/api/auth', createIdentityRouter(logger));

// Registered last, after all routes. Express 5 funnels async rejections here
// automatically, which Express 4 did not.
app.use(createErrorHandler(logger));

const redisClient = new Redis(env.REDIS_URL);
redisClient.on('connect', () => logger.info('Connected to Redis'));
redisClient.on('error', (err) => logger.error('Error connecting to Redis:', err));

/**
 * Startup order matters: Mongo -> RabbitMQ -> consumers -> HTTP listener.
 * The listener starts LAST so the container never accepts traffic it cannot service.
 */
async function startServer(): Promise<void> {
  try {
    await mongoose.connect(env.MONGODB_URL);
    logger.info('Connected to MongoDB');

    await connectToRabbitMQ(env.RABBITMQ_URL, logger);

    const handlers = createEventHandlers(logger);

    // Queue names are `<service>.<routingKey>` — stable across restarts and shared
    // across replicas, which is what stops fan-out duplicate processing (D-05).
    await consumeEvent(
      'identity.profilePhoto.updated',
      'profilePhoto.updated',
      handlers.handleProfileUploadEvent,
    );
    await consumeEvent(
      'identity.fetchTeamDetails',
      'fetchTeamDetails',
      handlers.handleTeamDetailEvent,
    );
    await consumeEvent(
      'identity.fetchTeamDetailsForMatchInviteCreated',
      'fetchTeamDetailsForMatchInviteCreated',
      handlers.handleTeamDetailForMatchInviteEvent,
    );
    await consumeEvent(
      'identity.fetchTeamDetailsForRespondingToInvite',
      'fetchTeamDetailsForRespondingToInvite',
      handlers.handleTeamDetailForRespondingToInviteEvent,
    );

    const server = app.listen(env.PORT, () => {
      logger.info(`identity-service is running on port ${env.PORT}`);
    });

    /**
     * Graceful shutdown. Stops accepting connections, then closes the bus and the
     * datastores. Without this, a deploy severs in-flight requests and leaks the
     * RabbitMQ channel — issue 11 in docs/architecture/00-system-overview.md.
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

// Preserved from the original: logs but does not exit. Backlog item 12 in the
// architecture docs notes this leaves the process in a possibly-inconsistent state.
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', promise, 'reason:', reason);
});

// New: the original had no uncaughtException handler at all, so a synchronous throw
// outside a request left the process running in an undefined state.
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception, exiting:', err);
  process.exit(1);
});
