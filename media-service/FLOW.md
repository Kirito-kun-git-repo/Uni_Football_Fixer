# media-service — Execution Flow

How execution actually travels through this service. Companion to
`docs/architecture/04-media-service.md`, which describes the service from the outside; this
describes it from the inside.

The whole service is two routes and one published event. Everything below hangs off the upload path.

## Startup order (`src/server.ts`)

`env.ts` loads and validates environment variables **at import time** — a missing variable throws
there, before anything connects. That is why `import { env } from './env.js'` is the first line of
`server.ts`: failing at import gives `Missing required environment variable: CLOUD_NAME` instead of
a Cloudinary 401 on the first upload hours later (D-MD-03).

1. `createLogger('media-service')`
2. Express middleware, in order: `cors` → `helmet` → `express.json` → request logger.
   **This order is the reverse of identity-service's** (`helmet` → `cors`). Preserved from the
   original; the practical difference is which of the two writes its headers first.
3. `GET /health` registered — reports `mongoose.connection.readyState`. Registered *before* the
   `/api/media` prefix, so an orchestrator's probe can never be rate-limited. It is **not** free of
   middleware, though: the four `app.use` calls in step 2 are global, so every probe runs through
   `cors` → `helmet` → `express.json` → request logger and writes two log lines. At the compose
   health-check's 10 s interval that is ~17k lines/day of pure noise, and it is the reason the
   service's log is almost entirely `/health` traffic (see *Observed runtime behaviour*).
4. Redis client constructed, then **connected with a top-level await** (D-MD-08). This has to
   happen before step 5: `rateLimit()` initialises its store during construction and
   `rate-limit-redis` caches that one attempt forever, so a not-yet-connected client leaves the
   limiter permanently broken.
5. `sensitiveRateLimiter` constructed — 50 requests / 60 s per IP, counters in Redis.
6. `app.use('/api/media', sensitiveRateLimiter)` then `app.use('/api/media', createMediaRouter(logger))`.
   Two mounts on the same prefix, in that order, so the limiter runs first.
7. `createErrorHandler` registered **last**, after all routes. Express 5 funnels async rejections
   here automatically; Express 4 did not.
8. `startServer()`: Mongo connect → RabbitMQ connect → **then** `app.listen`.

The listener starts last on purpose: the container never accepts traffic it cannot service.

9. `SIGTERM`/`SIGINT` → `shutdown()`: stop accepting → close RabbitMQ → close Mongo → close Redis
   → `process.exit(0)`.

   Two caveats that the phrase "graceful shutdown" oversells, both confirmed by reading the
   registration site rather than the intent:

   - **In-flight requests are not drained.** `server.close(cb)` is called but its callback is never
     awaited — it only stops *new* connections. The three `await`s that follow, and the
     `process.exit(0)` after them, run while an upload may still be mid-Cloudinary. That upload then
     fails on `save()` or `publishEvent` against an already-closed handle. Draining would require
     awaiting `server.close` (promisified) *before* closing the bus and datastores.
   - **The handlers are registered inside `startServer()`, after Mongo and RabbitMQ connect** — not
     at module scope. Between process start and that point, `SIGTERM` gets Node's default handling
     and kills the process outright. The window is ~150 ms in the healthy case observed below, but
     it is unbounded if Mongo is slow, which is exactly when a `docker compose stop` is likely.

   There is also no timeout guard: if `closeRabbitMQ()` hangs, nothing forces the exit and Docker
   waits out its 10 s grace period before `SIGKILL`. And `shutdown` is not idempotent — a second
   signal starts a second concurrent teardown.

Constructing the router at step 6 is what builds the whole object graph:
`createMediaRouter` → `createMediaController` → `createCloudinaryClient`, which is where
`cloudinary.config()` is called (D-MD-02).

## HTTP request paths

Both arrive from the gateway, which rewrites `/v1/media/*` → `/api/media/*`. The gateway has already
verified the JWT and injected `x-team-id`; this service verifies nothing and trusts that header
(`createAuthenticateRequest`, **not** `createValidateToken`). Backlog item 1.

| Route | Middleware chain | Controller | What it touches, in order |
|---|---|---|---|
| `POST /api/media/upload-logo` | limiter → `authenticateRequest` → multer wrapper | `uploadMedia` | `uploadMediaToCloudinary` → `new Media().save()` → `publishEvent('profilePhoto.updated')` → `201` |
| `GET /api/media/get` | limiter → `authenticateRequest` | `getAllMedia` | `Media.find({})` → `200 { Result: [...] }` |
| `GET /health` | the four global `app.use`s only — no auth, no limiter | — | `mongoose.connection.readyState` |

### The multer wrapper

multer is **not** mounted as ordinary middleware. `media-routes.ts` registers an inline handler that
calls `upload(req, res, cb)` itself, because the three failure modes need three different responses
before `uploadMedia` is ever reached:

| Condition | Response |
|---|---|
| `err instanceof multer.MulterError` (10 MB limit, wrong field name) | `400 { message: 'File upload error', error }` |
| any other `err` | `500 { message: 'Internal Server Error', error }` |
| parsed cleanly but no `file` field | `400 { message: 'No file uploaded' }` |
| clean | `next()` → `uploadMedia` |

The last two are both 400s with different body shapes (architecture doc issue 15). Only the clean
branch calls `next()`, so `uploadMedia`'s own `if (!mediaFile)` guard is unreachable in practice —
it survives as the guard that would matter if this wrapper were ever replaced by a plain
`router.post('/upload-logo', upload, ...)`.

`memoryStorage` means the complete file is resident before Cloudinary is called: N concurrent
uploads hold N × 10 MB (issue 9). There is no `fileFilter` and `resource_type: 'auto'`, so any
mimetype is accepted as a "logo" (issue 3).

## Event paths

media-service is a **publisher only**. It declares no queue and consumes nothing, so the D-05
named-durable-queue change has no call site here — the only thing it inherits from the shared client
is `{ persistent: true }` on the publish, which is what stops the message being dropped if
identity-service is down.

| Direction | Routing key | Payload | Consumer |
|---|---|---|---|
| Publishes | `profilePhoto.updated` | `{ url, teamId }`, both stringified at the call site | `identity-service` on queue `identity.profilePhoto.updated` → sets `Team.logoUrl` |
| Consumes | — | — | none (D-MD-04) |

The stringification is not cosmetic: `newlyCreatedMedia.teamId` is a Mongoose `ObjectId` (D-MD-05)
and `@uff/shared/events` types the contract as `{ teamId: string; url: string }`, so the
`.toString()` calls are what make the publish type-check.

The publish happens **after** `save()` and **before** the 201 — so a client that gets a 201 knows the
row exists, but not that identity-service has processed it. Nothing waits for or confirms the
downstream write.

## What the port changed

- `utils/rabbitmq.js`, `utils/logger.js`, `middleware/errorHandler.js`, and
  `middleware/authMiddleware.js` deleted — all four now come from `@uff/shared`. The local
  `authenticateRequest` and `createAuthenticateRequest` produce identical responses; the shared copy
  additionally narrows the header to a `string` and spells `Access` correctly in the warn line the
  local one wrote as `Acces`.
- `eventHandlers/media-event-handlers.js` deleted; it exported `{}` and the import of
  `handlePostDeleted` from it was `undefined` at runtime (D-MD-04).
- `GET /health` added — did not previously exist.
- `SIGTERM`/`SIGINT` graceful shutdown added — did not previously exist.
- `uncaughtException` handler added.
- Startup ordered and awaited: Redis before the limiter, then Mongo, then RabbitMQ, then the
  listener. The original awaited none of the three (D-MD-08, issue 6).
- Cloudinary credentials validated at import instead of on first upload (D-MD-03).
- Controller, router, and Cloudinary client became factories taking a logger (D-MD-02).
- `uploadMediaToCloudinary` rejects instead of resolving `undefined` (D-MD-06); same 500 to the
  client.
- `express-rate-limit`'s `max: 50` written as `limit: 50` (D-MD-10).
- `joi`, `jsonwebtoken`, `amqplib`, and `winston` dropped from `package.json` (D-MD-09).
- Dockerfile: `node:18-alpine` single stage → `node:24-alpine` multi-stage, built from the repo
  root (D-MD-11).

## What the port did NOT change

- **The `x-team-id` trust model.** Anyone who can reach port 3003 directly can upload as any team.
  Backlog item 1.
- **`GET /get` returns every media row for every team**, unfiltered and unpaginated. Issue 1.
- **`Media.teamId` is `ObjectId, ref: 'User'`** — a model that exists nowhere, and a type no other
  service uses for team ids. D-MD-05, issue 2.
- **No file-type validation.** Any mimetype is accepted; Cloudinary sniffs it. Issue 3.
- **Old media is never deleted.** A team uploading N logos leaves N−1 orphans in Cloudinary and
  Mongo. `deleteMediaFromCloudinary` still exists and is still called by nobody. Issue 4.
- **The three log defects** — `public_Id`, `console.log(req.file)`, and the `Request Body` line.
  Reproduced deliberately; D-MD-07. Note the third one does **not** actually print `[object Object]`
  on either real route, which is what this document previously claimed: Express 5 leaves `req.body`
  `undefined` unless a body parser populated it, and neither route gives `express.json()` anything to
  parse — `GET /get` has no body, and `POST /upload-logo` is `multipart/form-data`, which
  `express.json()` skips and multer parses *after* the logger has already run. Every observed line is
  `Request Body undefined`. The `[object Object]` form needs a JSON-bodied request, and this service
  has no route that takes one.
- **The capitalised `Result` key** in `GET /get`'s response body, and `Recieved` in the request log.
- **`unhandledRejection` logs without exiting.**
- **`cors()` wide open**, in this service as in the other four. Backlog item 6.
- **No index on `teamId`**, so any future per-team lookup scans the collection. Issue 10.
- **`redis` rather than `ioredis`** — deliberate, and the reason is D-MD-01, not inertia.

## Observed runtime behaviour

Audited against the live `uni_football_fixer` stack. Everything above this section was written from
the source; this section is what the running container actually did.

### Confirmed as documented

- **Startup order.** The log emits `Connected to Redis` → `Connected to MongoDB` → `Connected to
  RabbitMQ` → `Media service is running on port 3003`, in that order, spanning 130 ms. Redis first,
  listener last, exactly as steps 4–8 claim.
- **`/health`** returns `200 {"service":"media-service","status":"ok","mongo":1}`.
- **Route behaviour**, probed from inside the container: `GET /get` without `x-team-id` → 401;
  with it → `200 {"Result":[]}`; `POST /upload-logo` without the header → 401; with the header but
  no file → `400 {"message":"No file uploaded"}` (the wrapper's third branch, so `uploadMedia`'s own
  `!mediaFile` guard is indeed unreachable).
- **The rate limiter is genuinely live in Redis.** `RateLimit-Remaining` decremented 49 → 46 across
  four consecutive requests, which is the thing D-MD-08 exists to guarantee — had the store
  initialised against a disconnected client, every one of these would have thrown instead.
- **Publisher-only.** RabbitMQ shows four connections for five services (no consumer channel here),
  and media-service owns no queue. `identity.profilePhoto.updated` exists, is durable, and has 1
  consumer bound to `profilePhoto.updated` on `football.events` — the contract in *Event paths*
  holds on the broker side.
- **The `ObjectId` cast is safe in practice.** Issue 2 warns that `Media.teamId` is an `ObjectId`
  while other services use strings, which would make every upload a `CastError`. It does not:
  identity-service's `Team._id` *is* an `ObjectId`, so the `x-team-id` header is always a 24-hex
  string and casts cleanly. The type mismatch is a modelling wart, not a live fault.

### Not verified, and cannot be from inside this stack

`CLOUD_NAME`/`CLOUDINARY_API_KEY`/`CLOUDINARY_API_SECRET` are all the literal string `placeholder`,
and `scripts/smoke-test.mjs` says outright that upload is "NOT covered: it requires real Cloudinary
credentials". So **the entire write path is unexercised end-to-end** — Cloudinary upload, the
`Media` row, the `profilePhoto.updated` publish, and identity-service's `Team.logoUrl` write. A real
multipart upload during this audit reached Cloudinary and came back `401 Invalid api_key
placeholder`, returning a clean `500 {"message":"Internal Server Error"}` in 786 ms with no crash and
no partial row. That confirms the failure path only. The success path past `uploadMediaToCloudinary`
has never run anywhere.

### Fixed during the audit

**Cloudinary errors erased their own log context.** The SDK rejects with a plain object literal
(`{ message, name, http_code }`), not an `Error`. Winston merges a plain-object second argument into
the log meta, and its `message` key then *overrides* the message given as the first argument — so
both `logger.error('Error while Uploading media to Cloudinary:', error)` and the controller's
`logger.error('Error uploading media:', error)` emitted the identical line `Invalid api_key
placeholder`, twice, with no way to tell which frame produced either and no stack (`format.errors({
stack: true })` only fires for real `Error`s). `normaliseCloudinaryError` in `utils/cloudinary.ts`
now converts it to a real `Error`, carrying `name` and `http_code` across. Log shape only — the
rejection still lands in the same catch and the client still gets the same 500.

Note this is a *shared-logger* hazard, not a Cloudinary one: `logger.error('prefix:', x)` silently
loses `prefix` for **any** non-`Error` `x` carrying a `message` key, in every service. Fixing it
generally belongs in `packages/shared/src/logger.ts`, which is out of scope for this directory.

### Works, but fragile

1. **`/health` only checks Mongo.** If RabbitMQ or Redis dies, `readyState` is still 1, the endpoint
   still returns 200, the container stays `healthy`, and api-gateway keeps routing traffic here —
   while every upload 500s at `publishEvent` and every `/api/media` request 500s in the limiter.
   Widening the check is not free, though: api-gateway has `depends_on: media-service:
   service_healthy`, so a stricter probe makes a Redis blip cascade into a gateway restart.
2. **There is no RabbitMQ reconnect.** The shared client logs `RabbitMQ connection closed` on
   `close` and does nothing else. After a broker restart the channel is dead for the life of the
   process, and `requireChannel()` throws on every subsequent upload. Nothing recovers without a
   container restart.
3. **A failed publish still leaves committed state.** `publishEvent` runs *after* `save()`, so when
   the bus is down the client gets a 500 while the Cloudinary asset and the `Media` row both persist
   — and identity-service never learns. A retrying client duplicates both. The 201 is also not proof
   of delivery in the healthy case: `ch.publish` is fire-and-forget on a non-confirm channel, so it
   returns before the broker has accepted anything.
4. **Cloudinary is called before Mongo.** Any `save()` failure — the `unique` index on `publicId`,
   a validation error — orphans an asset that nothing will ever delete. `deleteMediaFromCloudinary`
   is the compensating action and is still called by nobody (issue 4).
5. **`/health` dominates the log.** Two `info` lines per probe every 10 s, so real events are
   needles in ~17k lines/day. The request logger should skip `/health`, or drop to `debug`.
