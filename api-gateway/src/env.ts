import 'dotenv/config';

/**
 * Centralised environment access, mirroring identity-service/src/env.ts.
 *
 * Under `strict`, `process.env.X` is `string | undefined`, and `proxy(target)` needs
 * a `string` — so the three service URLs have to be narrowed somewhere regardless.
 * Doing it here means a missing variable throws at import time with the variable's
 * name, rather than surfacing as a cryptic proxy failure on the first request that
 * happens to hit that route (D-GW-02, issue 8 in docs/architecture/01-api-gateway.md).
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  PORT: Number(process.env['PORT'] ?? 3000),
  NODE_ENV: process.env['NODE_ENV'] ?? 'development',
  REDIS_URL: required('REDIS_URL'),
  JWT_SECRET: required('JWT_SECRET'),
  IDENTITY_SERVICE_URL: required('IDENTITY_SERVICE_URL'),
  MEDIA_SERVICE_URL: required('MEDIA_SERVICE_URL'),
  MATCH_SERVICE_URL: required('MATCH_SERVICE_URL'),

  /**
   * Shared secret proving a request came through the gateway. OPTIONAL by design:
   * when unset the service behaves exactly as before, which keeps compose and
   * single-host deployments working unchanged. Set it whenever the service has a
   * publicly reachable URL. See packages/shared/src/auth.ts.
   */
  INTERNAL_SECRET: process.env['INTERNAL_SECRET'] ?? '',
} as const;
