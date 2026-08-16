# notification-service — Decision Log

Service-level decisions from the TypeScript port. Root decisions live in `docs/DECISIONS.md`.
Commits cite these IDs, so `git log --grep=D-NT-06` returns the code a decision produced.

The governing rule for this service was the behaviour-preservation rule in the design spec §2:
change the language, not the semantics. This service is unusually full of defects — the
architecture document lists eighteen — and almost every decision below is a decision *not* to fix
one. Where a deviation was made anyway it is marked **DEVIATION** and justified individually.

---

## D-NT-01 — Declared `mongoose` explicitly

**Decision:** added `"mongoose": "^9.9.2"` to `package.json`.

**Why:** `src/models/Notification.js` imported `mongoose` while the manifest never declared it. It
resolved only because npm hoisted the root monolith's copy into the top-level `node_modules`. That
works for `npm install` on a developer machine and fails for `npm ci` in a clean container with
`MODULE_NOT_FOUND` — which is precisely the scenario the new Dockerfile (D-NT-09) introduces, so
the phantom dependency had to be fixed before the container could ever start. Version per D-10.

**Note:** this is one of the two phantom dependencies the design spec §5 assigned to Phase 0.
It was still undeclared on this branch, so it is fixed here.

## D-NT-02 — Kept the global `authenticateRequest`, mounted after `/health`

**Decision:** `app.use(createAuthenticateRequest(logger))` is retained, sourced from
`@uff/shared/auth`, and placed immediately after the `/health` route.

**Why:** it guards zero routes — this service mounts no router and is not registered in the
gateway — so it looks like obvious dead scaffolding. It is not *quite* dead: it is the reason any
request to any path currently answers **401**. Deleting it would make those same requests answer
**404**, which is an observable HTTP behaviour change on a service with an open port. Keeping one
line is cheaper than justifying that change.

**Ordering matters and is the one adjustment made:** `/health` is registered *before* it. A
container health probe sends no `x-team-id` header, so a health endpoint behind this middleware
would answer 401 and the service would never be reported healthy. There was no `/health` route in
the original, so no prior ordering to preserve.

**Rejected:** deleting it, as identity-service did with its own unmounted copy (D-ID-04). That case
differed — identity's was never mounted at all, so removing it changed nothing. This one *is*
mounted.

## D-NT-03 — Kept the Redis client; dropped the entire rate-limiter stack

**Decision:** removed `express-rate-limit`, `rate-limit-redis`, `rate-limiter-flexible`, and
`redis`. Kept `ioredis` and the client construction with its `connect`/`error` log handlers.

**Why:** every rate limiter in `server.js` was commented out — roughly 100 lines of dead
configuration. The one `RateLimiterRedis` that was actually constructed was never applied to any
route, so removing it changes no observable behaviour. `redis` (`createClient`) was imported and
never used; only `ioredis` was ever constructed.

The client itself is kept for parity with identity-service and because it emits two log lines the
original emitted. Nothing in this service reads Redis, and after this port nothing plausibly will —
dropping it entirely and removing `REDIS_URL` from `env.ts` is a reasonable follow-up, deliberately
not taken here because it would diverge from the reference implementation.

**Risk:** re-enabling rate limiting later means re-adding a dependency. Backlog item 7.

## D-NT-04 — `createMailer()` factory; transport verification moved to startup

**Decision:** `utils/mailer.js`'s module-level transport became `createMailer(): Mailer`, called
once from `server.ts` inside `startServer()`.

**Why:** the original constructed the nodemailer transport and fired `transporter.verify()` as an
import side effect — importing `notificationService.js` opened an SMTP connection. A factory makes
the ordering explicit and lets the mailer be injected into `createNotificationService`, matching
the factory pattern the reference port established (D-ID-05).

**Behaviour delta:** `verify()` now runs after the Mongo and RabbitMQ connections instead of before
them. Its result gates nothing in either version — a failed verification logs and the service
starts anyway — so the only difference is the position of one console line in the startup log.

## D-NT-05 — Await the MongoDB connection; ordered startup

**Decision:** `await mongoose.connect(env.MONGODB_URL)` inside `startServer()`, before RabbitMQ and
before `app.listen`.

**Why:** **DEVIATION.** The original called `mongoose.connect(...).then(...)` at module scope and
never awaited it, so the RabbitMQ consumer could — and on a slow Mongo would — begin handling
notification events before the database was reachable. Combined with the now-durable queue (D-05),
which delivers a backlog immediately on startup, that race gets materially more likely after the
port, not less. Matching identity-service's ordered startup is the same call the reference port
made.

## D-NT-06 — `Notification.create()` reproduced verbatim, including the payload mismatch

**Decision:** both `create()` calls in `utils/mailer.ts` keep their original field set —
`metadata` and a top-level `status`, neither of which is a schema path, and no `recipientTeamId` or
`type`, both of which the schema requires. Compiling this needs a cast, so it carries one
(`as unknown as INotificationWrite`) with the reasoning inline.

**Why:** this is architecture-doc issue #1 and it is the single largest defect in the service.
Every `Notification.create()` rejects with a Mongoose `ValidationError`; the collection has never
held a row. Fixing it — on either side — would begin writing an audit trail that does not exist
today, which is new behaviour, not a port.

**The consequence is worse than the architecture doc records**, and is written up in FLOW.md: the
rejection escapes `sendMail` *after* the email has already gone out, so in `handleMatchFixed` the
first email is delivered and every subsequent one is cancelled. Verified by reading the control
flow, not observed against a live SMTP server.

**Verified the cast is load-bearing:** removing it produces
`TS2769: 'metadata' does not exist in type ...` on both call sites. It is not defensive noise.

## D-NT-07 — `console.log` / `console.error` in the mailer preserved

**Decision:** `utils/mailer.ts` still writes to `console`, not to the winston logger.

**Why:** architecture-doc issue #15. The original motivation for calling it a defect was that these
lines bypassed the winston *file* transports — and `@uff/shared/logger` removed those transports
entirely (D-03), so both now land on stdout regardless. What still differs is the format: winston
emits a colorised, service-tagged line and `console` emits raw text. Routing them through the
logger would change every one of those lines. Not worth breaking the preservation rule for a
formatting improvement.

**Consequence:** the mailer is the one file in this service that does not take a logger.

## D-NT-08 — Unescaped HTML interpolation in templates preserved

**Decision:** `utils/templates.ts` interpolates `teamName` and `collegeName` into HTML unescaped.

**Why:** architecture-doc issue #11, backlog item 11. Team-supplied strings reach an outbound email
body verbatim, which is an HTML-injection vector. Adding escaping is a security fix, and security
fixes are out of scope for a migration that is trying to keep exactly one variable moving (spec
§2). Recorded loudly rather than quietly patched.

The template functions take a structural `TemplateTeam` (`teamName?`, `collegeName?`) rather than
`TeamSummary` or `EnrichedTeam`, because both of those shapes reach them from different paths and
both have every field optional. A missing field interpolates as the literal string `undefined`,
which is the original behaviour.

## D-NT-09 — New multi-stage Dockerfile

**Decision:** added `notification-service/Dockerfile` on `node:24-alpine`, built from the repo
root, adapted from `identity-service/Dockerfile`.

**Why:** architecture-doc issue #5 — this service could not be containerised at all. The build
copies `package.json` from *every* workspace because `npm ci` validates `package-lock.json` against
every workspace declared in the root manifest; omitting the un-ported services fails the install
even though they are not built here. Only `@uff/shared` and `notification-service` are installed
and only their `dist/` reaches the runtime stage.

`--include-workspace-root` is deliberately NOT passed — it would pull the legacy monolith's
Express 4 tree into the image.

`EXPOSE 3005` is for the health endpoint alone; the service serves nothing else.

## D-NT-10 — Dropped `axios` and `express-http-proxy`

**Decision:** removed from `package.json`.

**Why:** neither is imported anywhere in the service. `express-http-proxy` in particular is
leftover from the api-gateway template this service was copy-pasted from — a proxy dependency in a
pure event consumer. Architecture-doc issue #17.

## D-NT-11 — Moved `winston`, `amqplib`, and `jsonwebtoken` out

**Decision:** all three removed from `package.json`.

**Why:** `winston` and `amqplib` are now reached only through `@uff/shared/logger` and
`@uff/shared/rabbitmq`, which declare them themselves. `jsonwebtoken` was never imported by this
service at all — the auth middleware it belonged to used only the `x-team-id` header, and that
middleware now comes from `@uff/shared/auth` too.

`express`, `cors`, and `helmet` are retained: they are still used directly, now solely to serve
`GET /health`.

## D-NT-12 — Corrected the port in the listen log

**Decision:** **DEVIATION.** The original bound `process.env.PORT || 3005` and logged
`` `Server is running on port ${process.env.PORT || 3004}` ``. The log now reports the port actually
bound.

**Why:** architecture-doc issue #14. A log line is not behaviour, it is a claim *about* behaviour,
and this one was false — it named a port nothing was listening on. Reproducing a false diagnostic
costs future operators real time and preserves nothing any consumer depends on. This is the same
class of call as D-ID-06 in the reference port.

## D-NT-13 — `new Redis(env.REDIS_URL)` instead of `new Redis({ url })`

**Decision:** **DEVIATION.** The original passed `new Redis({ url: process.env.REDIS_URL })`.

**Why:** `url` is not a valid `RedisOptions` key. ioredis ignored it and connected to
`localhost:6379`, so `REDIS_URL` had no effect whatsoever — the same misuse the architecture doc
flags across the other services. Under `strict` this is now a compile error (excess property check),
so it could not be carried over verbatim in any case. The corrected form is what identity-service
uses (D-ID-08 and its `server.ts`), and the compose stack requires it to reach a Redis that is not
on localhost.

**Behaviour delta:** the client now connects to the configured Redis rather than failing against
localhost. Since nothing reads Redis (D-NT-03), the only observable difference is which of the two
log lines gets emitted.

## D-NT-14 — Dropped two stray log lines

**Decision:** removed `logger.info("sensitive route applied")` and the unconditional
`logger.info("Connected to Redis")` inside `startServer`.

**Why:** both were residue of the commented-out rate-limiter block. The first announced a route
that was never applied. The second fired unconditionally, next to a commented-out
`await redisClient.connect()`, and duplicated the genuine message emitted by the client's own
`connect` handler — so it claimed a connection that had not been established. Both are false
statements rather than behaviour, same reasoning as D-NT-12.

## D-NT-15 — Kept the original file names

**Decision:** `services/notificationService.ts`, `utils/mailer.ts`, `utils/templates.ts`,
`models/Notification.ts` — no renames, only the extension change.

**Why:** identity-service renamed two files (D-ID-03), but only to fix a typo
(`identitty-controller.js`) and a genuinely confusing collision. Nothing here is misnamed. Renaming
to match the reference's kebab-case convention would have produced churn in a diff whose value is
being reviewable.

## D-NT-16 — `notification-service/package-lock.json` left untouched

**Decision:** the stale per-service lockfile is neither updated nor deleted.

**Why:** it predates the workspace conversion and npm ignores nested lockfiles inside a workspace,
so it is inert. Every sibling service still has one, including the already-ported
identity-service. Deleting it is Phase 2 cleanup, done once across all five, not four times in
parallel — the same reasoning that keeps agents off the root lockfile.
