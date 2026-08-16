import 'dotenv/config';

/**
 * Centralised environment access.
 *
 * Under `strict`, `process.env.X` is `string | undefined`, so every use site would
 * otherwise need a non-null assertion. Reading them here means the service fails
 * loudly at import time on a missing variable, instead of failing obscurely on first
 * use.
 *
 * D-MD-03: the three Cloudinary variables are validated here too. The original read
 * them at module load in `utils/cloudinary.js` with no check at all, so a typo in the
 * API secret surfaced only on the first upload attempt, as a Cloudinary 401 several
 * hours after deploy (architecture doc issue 12).
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  PORT: Number(process.env['PORT'] ?? 3003),
  NODE_ENV: process.env['NODE_ENV'] ?? 'development',
  MONGODB_URL: required('MONGODB_URL'),
  REDIS_URL: required('REDIS_URL'),
  RABBITMQ_URL: required('RABBITMQ_URL'),
  CLOUD_NAME: required('CLOUD_NAME'),
  CLOUDINARY_API_KEY: required('CLOUDINARY_API_KEY'),
  CLOUDINARY_API_SECRET: required('CLOUDINARY_API_SECRET'),
} as const;
