import winston from 'winston';

export type Logger = winston.Logger;

/**
 * Builds the logger every service uses. Called once per service, at the top of
 * `server.ts`, and the returned instance is threaded to controllers and handlers.
 *
 * Console-only by design: in a container, stdout is the log transport. The previous
 * per-service file transports are removed (D-03) — they wrote error.log/combined.log
 * into each service directory with no rotation, and those files ended up committed
 * to git.
 */
export function createLogger(serviceName: string): Logger {
  return winston.createLogger({
    level: process.env['NODE_ENV'] === 'production' ? 'info' : 'debug',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.splat(),
      winston.format.json(),
    ),
    defaultMeta: { service: serviceName },
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple(),
        ),
      }),
    ],
  });
}
