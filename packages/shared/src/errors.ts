import type { ErrorRequestHandler } from 'express';
import type { Logger } from './logger.js';

/** Errors thrown with a `status` are surfaced with that code; anything else is a 500. */
interface HttpError extends Error {
  status?: number;
}

/**
 * Terminal middleware — registered last in every service's `server.ts`, after all
 * routes. Express 5 routes async rejections here automatically, which Express 4 did
 * not; behaviour is otherwise identical to the five copies it replaces.
 */
export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (err: HttpError, _req, res, _next) => {
    logger.error(err.stack ?? err.message);
    res.status(err.status ?? 500).json({
      message: err.message || 'Internal Server Error',
    });
  };
}
