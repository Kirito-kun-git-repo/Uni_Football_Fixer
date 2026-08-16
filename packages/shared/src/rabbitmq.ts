import { connect, type Channel, type ChannelModel } from 'amqplib';
import { EXCHANGE_NAME, DLX_NAME, DLQ_NAME, type EventMap, type RoutingKey } from './events.js';
import type { Logger } from './logger.js';

let connection: ChannelModel | null = null;
let channel: Channel | null = null;
let log: Logger | null = null;

function requireChannel(): Channel {
  if (!channel) {
    throw new Error('RabbitMQ channel not initialised — call connectToRabbitMQ() first');
  }
  return channel;
}

/**
 * Opens the connection and declares the topology. Called once per service from
 * `server.ts`, before any consumer is registered and before the HTTP listener starts.
 *
 * Declares a durable topic exchange plus a dead-letter exchange and queue. Handlers
 * that throw send their message to `football.dlq` rather than dropping it (D-05).
 */
export async function connectToRabbitMQ(url: string, logger: Logger): Promise<void> {
  log = logger;
  connection = await connect(url);
  channel = await connection.createChannel();

  await channel.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });
  await channel.assertExchange(DLX_NAME, 'fanout', { durable: true });
  await channel.assertQueue(DLQ_NAME, { durable: true });
  await channel.bindQueue(DLQ_NAME, DLX_NAME, '');

  // Bounds how many unacked messages a restarted consumer pulls at once, so it
  // does not inhale an entire accumulated backlog in one go.
  await channel.prefetch(10);

  connection.on('error', (err: Error) => logger.error('RabbitMQ connection error', err));
  connection.on('close', () => logger.warn('RabbitMQ connection closed'));

  logger.info('Connected to RabbitMQ');
}

/**
 * Publishes a typed event. The generic ties `message` to the routing key, so passing
 * a payload that does not match the key is a compile error rather than a runtime
 * surprise in a consumer four hops away.
 */
export async function publishEvent<K extends RoutingKey>(
  routingKey: K,
  message: EventMap[K],
): Promise<void> {
  const ch = requireChannel();
  ch.publish(EXCHANGE_NAME, routingKey, Buffer.from(JSON.stringify(message)), {
    persistent: true,
    contentType: 'application/json',
  });
  log?.info(`Event published with routing key: ${routingKey}`);
}

/**
 * Binds a NAMED DURABLE queue to a routing key and consumes it.
 *
 * `queueName` must be stable across restarts and identical across replicas of the
 * same service — use `<service>.<routingKey>`. This is the change that makes the
 * bus survive a consumer being down and stops two replicas from each processing
 * every message (D-05).
 *
 * The handler is awaited before the ack. A handler that throws nacks without requeue,
 * routing the message to the DLX instead of losing it or spinning forever.
 */
export async function consumeEvent<K extends RoutingKey>(
  queueName: string,
  routingKey: K,
  handler: (payload: EventMap[K]) => Promise<void>,
): Promise<void> {
  const ch = requireChannel();

  await ch.assertQueue(queueName, {
    durable: true,
    deadLetterExchange: DLX_NAME,
  });
  await ch.bindQueue(queueName, EXCHANGE_NAME, routingKey);

  await ch.consume(queueName, (msg) => {
    if (msg === null) return;
    // `consume` takes a synchronous callback, so the async work is launched here and
    // deliberately not awaited by the caller. The ack/nack decision happens inside.
    void (async () => {
      try {
        const payload = JSON.parse(msg.content.toString()) as EventMap[K];
        await handler(payload);
        ch.ack(msg);
        log?.info(`Event consumed with routing key: ${routingKey}`);
      } catch (err) {
        log?.error(`Handler failed for ${routingKey}, dead-lettering`, err);
        ch.nack(msg, false, false);
      }
    })();
  });

  log?.info(`Subscribed to ${routingKey} on queue ${queueName}`);
}

/** Wired to SIGTERM so a deploy drains rather than severing in-flight work. */
export async function closeRabbitMQ(): Promise<void> {
  try {
    await channel?.close();
    await connection?.close();
    log?.info('RabbitMQ connection closed cleanly');
  } catch (err) {
    log?.error('Error closing RabbitMQ', err);
  } finally {
    channel = null;
    connection = null;
  }
}
