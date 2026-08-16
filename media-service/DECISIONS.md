# media-service — Decision Log

Service-level decisions from the TypeScript port. Root decisions live in `docs/DECISIONS.md`.
Commits cite these IDs, so `git log --grep=D-MD-08` returns the code a decision produced.

## D-MD-01 — Kept `redis` (node-redis); did not switch to `ioredis`

**Decision:** media-service stays on the `redis` package (node-redis, bumped to `^6.2.1`) while
every other service uses `ioredis`. The inconsistency is deliberate.

**Why:** it is the only service whose Redis client is on a live request path. The other services
constructed a client that nothing consumed — identity-service dropped `redis` outright (D-ID-02)
because the rate limiters that would have used it were commented out. Here the client backs the
*one working rate limiter in the system*, through
`sendCommand: (...args) => redisClient.sendCommand(args)`. Swapping to ioredis means rewriting that
bridge (`client.call(...args)`), and inherits a different reconnect strategy, a different offline
command queue, and different behaviour when Redis is briefly unavailable — all on the path that
decides whether a request is served or 429'd. That is a behaviour change wearing a consistency
costume, and the migration's rule is language-not-semantics.

**Rejected:** switching to ioredis for cross-service uniformity. Worth doing, but as its own change
with the smoke test already in place — not folded into a language port.

**Consequence:** the monorepo ships two Redis clients. A future reader will find this entry rather
than assuming the inconsistency was an oversight, which is the whole reason it is written down.

## D-MD-02 — Controller, router, and Cloudinary client built by factory functions

**Decision:** `createMediaRouter(logger)` → `createMediaController(logger)` →
`createCloudinaryClient(logger)`, instead of module-level singletons.

**Why:** `@uff/shared/logger` exports `createLogger(serviceName)` rather than a pre-built instance,
because the service name has to be bound somewhere. Factories are the smallest change that lets the
logger be injected once in `server.ts` and threaded down. Matches identity-service (D-ID-05).

## D-MD-03 — Cloudinary credentials validated at import time

**Decision:** `CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` go through `env.ts`'s
`required()` helper, so a missing one throws before anything connects.

**Why:** the original read all three from `process.env` at module load in `utils/cloudinary.js` with
no validation, so a missing secret produced a Cloudinary 401 on the first upload — possibly hours
after deploy, and surfacing as a generic 500 to the client (architecture doc issue 12). This is the
same treatment `env.ts` already gives `MONGODB_URL` and friends in the reference port.

**Deviation:** this is a behaviour change. A misconfigured container now fails to start instead of
starting and failing every upload. Recorded rather than silent.

## D-MD-04 — Deleted `eventHandlers/media-event-handlers.js` and its dead subscription

**Decision:** the file is removed, not ported. `server.ts` has no `consumeEvent` call.

**Why:** the module's entire body was commented out and it exported `{}`. `server.js` imported
`handlePostDeleted` from it, so that binding was `undefined` at runtime; it was harmless only
because the `consumeEvent('post.deleted', ...)` line that would have used it was also commented out
(architecture doc issue 5). Both are dead code, not behaviour — the same call the task made about
the commented-out rate limiter blocks elsewhere.

**Consequence:** media-service publishes and never consumes. It is the only service with no queue,
so the D-05 named-durable-queue change does not apply to it at all.

## D-MD-05 — `Media.teamId` keeps `ObjectId, ref: 'User'`

**Decision:** preserved exactly, including the reference to a model that does not exist.

**Why:** behaviour-preserving. `'User'` is inert — nothing calls `.populate()` on it — but the
ObjectId *type* is not: it is what casts the `x-team-id` header string on the way in, and it is why
the controller calls `.toString()` before publishing. Changing the field to `String` (which is what
match-service and notification-service use) would silently change what a malformed `x-team-id`
does: today it is a Mongoose `CastError` caught into a 500, and afterwards it would be a persisted
row with a garbage id. Architecture doc issue 2; deferred.

## D-MD-06 — `uploadMediaToCloudinary` rejects rather than resolving `undefined`

**Decision:** an explicit `if (!result) reject(...)` was added to the `upload_stream` callback.

**Why:** Cloudinary types the callback result as optional, so under `strict` the original
`resolve(result)` does not compile against a `Promise<UploadApiResponse>` return type — and that
return type is required by the port brief. Resolving `undefined` only moved the failure one frame
later: the controller read `.public_id` off `undefined`, threw a `TypeError`, and its catch returned
`500 {"message":"Internal Server Error"}`. The rejection produces the byte-identical response and
puts a legible cause in the log instead of a `TypeError`.

## D-MD-07 — Three logging defects reproduced, not fixed

**Decision:** all three are carried into the TypeScript version verbatim, each with an adjacent
comment naming the defect:

| Where | Defect |
|---|---|
| `media-controller.ts` | `cloudinaryUploadResult.public_Id` — wrong casing, always logs `undefined` (issue 7) |
| `media-controller.ts` | `console.log(req.file)` — debug statement bypassing the winston logger (issue 8) |
| `server.ts` | ``logger.info(`Request Body ${req.body}`)`` — interpolates an object, prints `[object Object]` |

**Why:** the behaviour-preserving rule says to reproduce what is wrong and record it, and none of
the three crashes. This is the line identity-service's D-ID-06 did *not* cross: there, the original
threw a `ReferenceError` inside an error handler, destroying the diagnostic it was meant to emit, so
fixing it restored behaviour rather than changing it. A log line that reads `undefined` loses
nothing that was ever there.

**Note:** `public_Id` compiles only because Cloudinary's `UploadApiResponse` carries an
`[futureKey: string]: any` index signature — `strict` cannot catch it. Each is a one-token fix
whenever the backlog is picked up.

## D-MD-08 — Redis connects *before* the rate limiter is constructed

**Decision:** `await redisClient.connect()` runs at module scope, as a top-level await, ahead of the
`rateLimit({ store: new RedisStore(...) })` call — not inside `startServer()` next to Mongo and
RabbitMQ.

**Why:** found by running the service. `rateLimit()` invokes `store.init()` during construction, and
`rate-limit-redis` caches the resulting `SCRIPT LOAD` promise in `incrementScriptSha` **once,
permanently**. With the client not yet connected, that cached promise is a rejection, and
`retryableIncrement` rethrows it on every subsequent request — it only retries `NOSCRIPT` errors, so
there is no recovery. The limiter fails closed forever and every request to `/api/media` 500s. The
original avoided this by accident: it called the unawaited `redisClient.connect()` several lines
above the `rateLimit(...)` construction, so a connection was at least in flight.

**Also fixes:** architecture doc issue 6 — the unawaited `redisClient.connect()` whose rejection was
unhandled. A Redis that is unreachable at boot is now a logged `process.exit(1)` instead of an
unhandled rejection plus a permanently broken limiter.

**Consequence:** media-service will not start without Redis. That is the correct failure mode for a
service whose only public routes sit behind a Redis-backed limiter, but it is a new hard dependency
at boot and needs `depends_on` in the Phase 2 compose file.

## D-MD-09 — Dropped `joi`, `jsonwebtoken`, `amqplib`, and `winston`

**Decision:** all four removed from `package.json`.

**Why:** two were never imported — `joi` was installed but no validation schema exists anywhere in
this service (unlike identity-service, which genuinely uses it), and `jsonwebtoken` was installed
even though this service verifies no token: it trusts the `x-team-id` header via
`createAuthenticateRequest` (architecture doc issue 11). The other two moved rather than
disappeared: `amqplib` is now reached through `@uff/shared/rabbitmq` and `winston` through
`@uff/shared/logger`, so declaring them here would be a second, independently-drifting version of a
dependency the shared package owns.

**Risk:** adding request-body validation later means re-adding `joi`. There is no body to validate
on either route today — one is multipart, the other takes no input.

## D-MD-10 — Rate limiting kept, re-expressed for express-rate-limit 8

**Decision:** `express-rate-limit` and `rate-limit-redis` stay (at `^8.6.2` / `^6.0.1`), and the
50-requests-per-minute limiter on `/api/media` stays mounted. The option `max: 50` is written as
`limit: 50`.

**Why:** unlike the three services where every limiter was commented out, this one is live and is
the only request-rate protection in front of a 10 MB file upload. `max` is the pre-v7 spelling of
`limit`; v8 still honours it but warns. Same window, same ceiling, same 429 body — the rename is
the option name catching up, not a policy change.

**Note:** `rate-limit-redis` 6 requires `express-rate-limit >= 8.6.0`, which is why both majors move
together.

## D-MD-11 — Dockerfile copies all six workspace manifests

**Decision:** the multi-stage build copies `package.json` from *every* workspace, including the four
it does not build.

**Why:** `npm ci` validates `package-lock.json` against every workspace declared in the root
`package.json`; omitting the others fails the install even though they are not in this image. Only
`packages/shared` and `media-service` are installed (`--workspace` flags) and only their `dist/`
reaches the runtime stage. `--include-workspace-root` is deliberately not passed — it would pull the
legacy monolith's Express 4 tree into the image. Inherited wholesale from D-ID-09.

## D-MD-12 — Legacy `media-service/package-lock.json` left untouched

**Decision:** not regenerated, not deleted.

**Why:** it predates the workspace and is inert — npm workspaces resolves from the root lockfile, so
nothing reads this file. Regenerating it would commit a lockfile, which the Phase 1 ownership rules
forbid; deleting it would diverge from identity-service, which still carries its own. Phase 2
regenerates lockfiles once, and that is the moment to decide whether the per-service copies survive
at all.

**Reader beware:** its contents describe the *pre-port* dependency set (`amqplib`, `winston`, `joi`).
It is not a record of what this service installs.
