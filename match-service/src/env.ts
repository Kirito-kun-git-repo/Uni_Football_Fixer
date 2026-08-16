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

  /**
   * Per-request deadline for the synchronous enrichment lookups in both invite
   * controllers. Applies to each individual `getTeamById` call, not to the batch.
   *
   * Raised from the original hardcoded 700 ms in `createInvite`, and applied for the
   * first time to `respondToInvite`, which previously passed no timeout at all.
   *
   * 700 ms had to cover two chained network hops — match → gateway → identity →
   * Mongo — which is comfortable on a warm local stack and has no headroom on a
   * loaded one. Overshooting the deadline is not a harmless retry here: the caller
   * swallows the failure and publishes a `notification` carrying only team ids, and
   * notification-service cannot send an email without an address. Waiting longer for
   * a correct payload beats failing fast into a degraded one.
   *
   * Overridable without a compose change, so this can be tuned per environment
   * rather than recompiled.
   */
  ENRICHMENT_TIMEOUT_MS: Number(process.env['ENRICHMENT_TIMEOUT_MS'] ?? 2500),

  /**
   * Shared secret proving a request came through the gateway. OPTIONAL by design:
   * when unset the service behaves exactly as before, which keeps compose and
   * single-host deployments working unchanged. Set it whenever the service has a
   * publicly reachable URL. See packages/shared/src/auth.ts.
   */
  INTERNAL_SECRET: process.env['INTERNAL_SECRET'] ?? '',
} as const;
