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
   `/api/media` prefix, so an orchestrator's probe can never be rate-limited.
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

9. `SIGTERM`/`SIGINT` → `shutdown()`: stop accepting → close RabbitMQ → close Mongo → close Redis.

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
| `GET /health` | none | — | `mongoose.connection.readyState` |

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
- **The three log defects** — `public_Id`, `console.log(req.file)`, and `Request Body [object
  Object]`. Reproduced deliberately; D-MD-07.
- **The capitalised `Result` key** in `GET /get`'s response body, and `Recieved` in the request log.
- **`unhandledRejection` logs without exiting.**
- **`cors()` wide open**, in this service as in the other four. Backlog item 6.
- **No index on `teamId`**, so any future per-team lookup scans the collection. Issue 10.
- **`redis` rather than `ioredis`** — deliberate, and the reason is D-MD-01, not inertia.
