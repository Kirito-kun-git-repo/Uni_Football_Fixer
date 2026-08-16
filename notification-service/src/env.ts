import 'dotenv/config';

/**
 * Centralised environment access, identical in shape to identity-service's `env.ts`.
 *
 * Under `strict`, `process.env.X` is `string | undefined`, so every use site would
 * otherwise need a non-null assertion. Reading them here means the service fails
 * loudly at import time on a missing variable, instead of failing obscurely on first
 * use — an `undefined` Mongo connection string otherwise surfaces as a confusing
 * driver error several seconds into startup.
 *
 * "Required" means *infrastructure the service cannot run without*. The SMTP
 * credentials are deliberately NOT in that set — see `optionalEmail` below.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * SMTP credentials are OPTIONAL, and that is a deliberate reversal of the first cut
 * of this file.
 *
 * The port originally routed `EMAIL_USER` / `EMAIL_APP_PASSWORD` through `required()`
 * so a missing app password failed at boot rather than on the first outbound email.
 * That reads well in isolation but contradicts the contract the rest of the stack is
 * built on: `docker-compose.yml` passes `EMAIL_USER: ${EMAIL_USER:-}` with the comment
 * "the stack must come up without real credentials", and `.env.example` ships both
 * keys blank while stating the stack boots without them. `required()` rejects `''`,
 * so the documented `cp .env.example .env` path made this service throw at import
 * time, exit, and — under `restart: unless-stopped` — crash-loop forever, never
 * becoming healthy. Verified against the running stack.
 *
 * Booting without mail configured is the supported state: this service's only working
 * path (`match.fixed`) is a leaf, so an unconfigured mailer degrades email delivery
 * and nothing else. The diagnostic that `required()` was reaching for is preserved as
 * a loud startup warning in `utils/mailer.ts` instead of a fatal throw.
 */
function optionalEmail(name: string): string {
  return process.env[name] ?? '';
}

export const env = {
  PORT: Number(process.env['PORT'] ?? 3005),
  NODE_ENV: process.env['NODE_ENV'] ?? 'development',
  MONGODB_URL: required('MONGODB_URL'),
  REDIS_URL: required('REDIS_URL'),
  RABBITMQ_URL: required('RABBITMQ_URL'),
  EMAIL_USER: optionalEmail('EMAIL_USER'),
  EMAIL_APP_PASSWORD: optionalEmail('EMAIL_APP_PASSWORD'),

  /**
   * Direct SMTP host, used INSTEAD of Gmail when set.
   *
   * This exists so outbound mail can be verified without real Gmail credentials:
   * docker-compose points it at a Mailpit container, which accepts every message and
   * exposes them over HTTP so the smoke test can assert that an email was actually
   * delivered rather than merely attempted. Before this, notification-service's only
   * reason to exist was unverifiable on any machine without a Google app password.
   *
   * Unset in production, where the Gmail transport is used unchanged.
   */
  SMTP_HOST: process.env['SMTP_HOST'] ?? '',
  SMTP_PORT: Number(process.env['SMTP_PORT'] ?? 1025),
} as const;

/**
 * True when the service has SOME way to send mail — either a direct SMTP host or a
 * complete Gmail credential pair. Read by `createMailer()` to decide whether to warn.
 */
export const emailConfigured: boolean = Boolean(
  env.SMTP_HOST || (env.EMAIL_USER && env.EMAIL_APP_PASSWORD),
);
