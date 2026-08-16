import 'dotenv/config';

/**
 * Centralised environment access.
 *
 * Under `strict`, `process.env.X` is `string | undefined`, so every use site would
 * otherwise need a non-null assertion. Reading them here means the service fails
 * loudly at import time on a missing variable, instead of failing obscurely on first
 * use.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  PORT: Number(process.env['PORT'] ?? 3004),
  NODE_ENV: process.env['NODE_ENV'] ?? 'development',
  MONGODB_URL: required('MONGODB_URL'),
  REDIS_URL: required('REDIS_URL'),
  RABBITMQ_URL: required('RABBITMQ_URL'),

  /**
   * Base URL for the synchronous enrichment calls in the two invite controllers.
   *
   * D-MT-02: the original hardcoded `http://localhost:3000` at three call sites. The
   * default here is byte-identical, so behaviour outside a container is unchanged —
   * but it is now overridable, which is what makes the service reachable under
   * docker-compose in Phase 2. Note this points at the GATEWAY, not identity-service:
   * the enrichment calls re-enter the public edge. Backlog item 3.
   */
  GATEWAY_URL: process.env['GATEWAY_URL'] ?? 'http://localhost:3000',
} as const;
