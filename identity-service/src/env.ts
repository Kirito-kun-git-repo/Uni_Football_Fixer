import 'dotenv/config';

/**
 * Centralised environment access.
 *
 * Under `strict`, `process.env.X` is `string | undefined`, so every use site would
 * otherwise need a non-null assertion. Reading them here means the service fails
 * loudly at import time on a missing variable, instead of failing obscurely on first
 * use — a Mongo connection string that is `undefined` otherwise surfaces as a
 * confusing driver error several seconds into startup.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  PORT: Number(process.env['PORT'] ?? 3001),
  NODE_ENV: process.env['NODE_ENV'] ?? 'development',
  MONGODB_URL: required('MONGODB_URL'),
  REDIS_URL: required('REDIS_URL'),
  RABBITMQ_URL: required('RABBITMQ_URL'),
  JWT_SECRET: required('JWT_SECRET'),

  /**
   * Shared secret proving a request came through the gateway. OPTIONAL by design:
   * when unset the service behaves exactly as before, which keeps compose and
   * single-host deployments working unchanged. Set it whenever the service has a
   * publicly reachable URL. See packages/shared/src/auth.ts.
   */
  INTERNAL_SECRET: process.env['INTERNAL_SECRET'] ?? '',
} as const;
