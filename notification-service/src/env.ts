import 'dotenv/config';

/**
 * Centralised environment access, identical in shape to identity-service's `env.ts`.
 *
 * Under `strict`, `process.env.X` is `string | undefined`, so every use site would
 * otherwise need a non-null assertion. Reading them here means the service fails
 * loudly at import time on a missing variable, instead of failing obscurely on first
 * use — an `undefined` Mongo connection string otherwise surfaces as a confusing
 * driver error several seconds into startup, and a missing `EMAIL_APP_PASSWORD`
 * surfaces only when the first invite arrives.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  PORT: Number(process.env['PORT'] ?? 3005),
  NODE_ENV: process.env['NODE_ENV'] ?? 'development',
  MONGODB_URL: required('MONGODB_URL'),
  REDIS_URL: required('REDIS_URL'),
  RABBITMQ_URL: required('RABBITMQ_URL'),
  EMAIL_USER: required('EMAIL_USER'),
  EMAIL_APP_PASSWORD: required('EMAIL_APP_PASSWORD'),
} as const;
