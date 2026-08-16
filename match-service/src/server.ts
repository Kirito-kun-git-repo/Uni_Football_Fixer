import { env } from './env.js';
import express from 'express';
import mongoose from 'mongoose';
import helmet from 'helmet';
import cors from 'cors';
// D-ID-08 / D-MT-03: ioredis 6 must be imported by NAME. Under module:nodenext the
// default export does not resolve to a constructable type.
import { Redis } from 'ioredis';
import { createLogger } from '@uff/shared/logger';
import { createErrorHandler } from '@uff/shared/errors';
import { createAuthenticateRequest } from '@uff/shared/auth';
import { connectToRabbitMQ, consumeEvent, closeRabbitMQ } from '@uff/shared/rabbitmq';
import { createMatchRouter } from './routes/matchRoutes.js';
import { createInviteRouter } from './routes/inviteRoutes.js';
import { createEventHandlers } from './eventHandlers/match-event-handlers.js';

const logger = createLogger('match-service');
const app = express();

//middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use((req, _res, next) => {
  logger.info(`  Recieved ${req.method} Request to  ${req.url}`);
  // Prints "[object Object]" — winston does not interpolate an object into a template
  // string. Preserved from the original; issue 19.
  logger.info(`Request Body ${req.body}`);
  next();
});

/**
 * Liveness + readiness. docker-compose health-checks this.
 *
 * Registered BEFORE `authenticateRequest` below, which is mounted globally and would
 * otherwise demand an `x-team-id` header from the health probe. Every other route in
 * this service sits behind that gate — including `get-matches`, documented as the
 * public display board (issue 11).
 */
app.get('/health', (_req, res) => {
  const mongoReady = mongoose.connection.readyState === 1;
  res.status(mongoReady ? 200 : 503).json({
    service: 'match-service',
    status: mongoReady ? 'ok' : 'degraded',
    mongo: mongoose.connection.readyState,
  });
});

//routes
// Trusts the `x-team-id` header the gateway injects, with no verification of any
// kind. Applied globally, before both routers, exactly as the original did.
app.use(createAuthenticateRequest(logger, env.INTERNAL_SECRET));

// Both routers mount on the same prefix. inviteRoutes MUST stay first: matchRoutes
// ends in a `GET /:id` catch-all that would otherwise shadow the invite GETs.
app.use('/api/match', createInviteRouter(logger));
app.use('/api/match', createMatchRouter(logger));

logger.info('match route applied');

//error handling middleware
// Registered last, after all routes. Express 5 funnels async rejections here
// automatically, which Express 4 did not.
app.use(createErrorHandler(logger));

/**
 * D-MT-03: vestigial. Nothing in the request path uses Redis — the client existed
 * only to back the rate limiters, which were commented out and are now removed. Kept
 * so the service's dependency footprint and startup logging are unchanged.
 */
const redisClient = new Redis(env.REDIS_URL);
redisClient.on('connect', () => logger.info('Connected to Redis'));
redisClient.on('error', (err) => logger.error('Error connecting to Redis:', err));

/**
 * How long `shutdown()` gets before it stops waiting and exits non-zero. Kept under
 * Docker's 10s default stop grace period so this process, not the runtime, decides
 * how it dies.
 */
const SHUTDOWN_TIMEOUT_MS = 8000;

/** Guards `shutdown()` against re-entry when a second signal arrives. */
let shuttingDown = false;

/**
 * Startup order matters: Mongo -> RabbitMQ -> consumers -> HTTP listener.
 * The listener starts LAST so the container never accepts traffic it cannot service.
 * The original connected to Mongo outside this sequence and never awaited it, so the
 * service could accept a request before the database was up.
 */
async function startServer(): Promise<void> {
  try {
    await mongoose.connect(env.MONGODB_URL);
    logger.info('Connected to MongoDB');

    await connectToRabbitMQ(env.RABBITMQ_URL, logger);
    logger.info('RabbitMQ connection established successfully');

    const handlers = createEventHandlers(logger);

    // Queue names are `<service>.<routingKey>` — stable across restarts and shared
    // across replicas, which is what stops fan-out duplicate processing (D-05).
    await consumeEvent('match.TeamDetails', 'TeamDetails', handlers.handleTeamDetailEvent);
    await consumeEvent(
      'match.TeamDetailsForMatchInvite',
      'TeamDetailsForMatchInvite',
      handlers.handleTeamDetailForMatchInviteEvent,
    );
    await consumeEvent(
      'match.teamDetailsForRespondingToInvite',
      'teamDetailsForRespondingToInvite',
      handlers.handleTeamDetailForRespondingToInviteEvent,
    );

    const server = app.listen(env.PORT, () => {
      logger.info(`Server is running on port ${env.PORT}`);
    });

    /**
     * Graceful shutdown: stop accepting, drain what is in flight, then close the bus
     * and the datastores.
     *
     * The previous version claimed to drain but did not. `server.close()` was called
     * without awaiting its callback and `process.exit(0)` ran unconditionally, so an
     * in-flight response was in a race with the exit; and because the function had no
     * try/catch while being invoked as `void shutdown(...)`, a rejecting close landed
     * in `unhandledRejection` — which logs without exiting — leaving the process to
     * sit until Docker's SIGKILL. All three are addressed below.
     */
    const shutdown = async (signal: string): Promise<void> => {
      // A second SIGTERM (or a SIGINT chasing a SIGTERM) would otherwise re-enter and
      // close an already-closed channel, which throws.
      if (shuttingDown) {
        logger.warn(`${signal} received while already shutting down, ignoring`);
        return;
      }
      shuttingDown = true;
      logger.info(`${signal} received, shutting down`);

      /**
       * Hard deadline. Docker's default stop grace period is 10s, so exiting
       * deliberately at 8s means this process picks its own exit code instead of
       * being SIGKILLed part-way through closing Mongo. `unref` so the timer itself
       * never holds the event loop open.
       */
      const forceExit = setTimeout(() => {
        logger.error(`Shutdown exceeded ${SHUTDOWN_TIMEOUT_MS}ms, forcing exit`);
        process.exit(1);
      }, SHUTDOWN_TIMEOUT_MS);
      forceExit.unref();

      try {
        // Awaited, unlike before. `close()` stops new connections and resolves once
        // in-flight responses finish; `closeIdleConnections()` drops keep-alive
        // sockets that are parked between requests, which is what would otherwise
        // keep this pending until the deadline above — the gateway holds exactly
        // such sockets open.
        const closed = new Promise<void>((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        });
        server.closeIdleConnections();
        await closed;
        logger.info('HTTP server closed');

        await closeRabbitMQ();
        await mongoose.connection.close();
        redisClient.disconnect();

        clearTimeout(forceExit);
        logger.info('Shutdown complete');
        process.exit(0);
      } catch (err) {
        // Reached rather than escaping to `unhandledRejection`, so a failed close
        // still terminates the process instead of hanging it.
        clearTimeout(forceExit);
        logger.error('Error during shutdown, exiting non-zero:', err);
        process.exit(1);
      }
    };

    // `shutdown` handles its own failures and never rejects, so `void` here can no
    // longer produce an unhandled rejection.
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
  } catch (err) {
    logger.error('Error starting server:', err);
    process.exit(1);
  }
}

void startServer();

//unhandled promise rejections
// Preserved from the original: logs but does not exit.
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', promise, 'reason:', reason);
});

// New: the original had no uncaughtException handler at all, so a synchronous throw
// outside a request left the process running in an undefined state.
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception, exiting:', err);
  process.exit(1);
});
