# identity-service — Execution Flow

How execution actually travels through this service. Companion to
`docs/architecture/02-identity-service.md`, which describes the service from the outside;
this describes it from the inside.

## Startup order (`src/server.ts`)

`env.ts` loads and validates environment variables **at import time** — a missing variable throws
there, before anything connects. This is why `import { env } from './env.js'` is the first line of
`server.ts`: failing at import gives `Missing required environment variable: MONGODB_URL` instead
of an opaque driver timeout thirty seconds later.

1. `createLogger('identity-service')`
2. Express middleware, in order: `helmet` → `cors` → `express.json` → request logger
3. `GET /health` registered — reports `mongoose.connection.readyState`
4. `/api/auth` router mounted
5. `createErrorHandler` registered **last**, after all routes. Express 5 funnels async rejections
   here automatically; Express 4 did not.
6. Redis client constructed. Note: **no request path uses Redis** — it exists only because the
   original server did, and the rate limiters that consumed it are gone (D-ID-02).
7. `startServer()`: Mongo connect → RabbitMQ connect → 4 consumers registered → **then** `app.listen`

The listener starts last on purpose: the container never accepts traffic it cannot service.

8. `SIGTERM`/`SIGINT` → `shutdown()`: stop accepting → close RabbitMQ → close Mongo → disconnect Redis

## HTTP request paths

All arrive from the gateway, which rewrites `/v1/auth/*` → `/api/auth/*`.
**No JWT is required on any of these** — this is where tokens are issued, so the gateway
deliberately does not apply `validateToken` to this proxy.

| Route | Controller | What it touches, in order |
|---|---|---|
| `POST /api/auth/register` | `registration` | `validateRegistration` → `Team.findOne({$or:[email,teamName]})` → `new Team().save()` (pre-save hook argon2-hashes) → `generateToken` |
| `POST /api/auth/login` | `loginUser` | `validateLogin` → `Team.findOne({email})` → `team.comparePassword` (argon2.verify) → `generateToken` |
| `POST /api/auth/refresh-token` | `refreshTokenUser` | `RefreshToken.findOne` → explicit expiry check → `Team.findById` → `generateToken` → `RefreshToken.deleteOne` (rotation) |
| `POST /api/auth/logout` | `logoutUser` | `RefreshToken.deleteOne({token})` |
| `GET /api/auth/getTeamById/:teamId` | `getTeamById` | `Team.findById` → returns the **full document** |

**`getTeamById` is the one route another service calls.** match-service hits it via axios through
the gateway during synchronous enrichment, with a 700 ms timeout. It sits on the hot path of the
invite flow, and when it is slow the flow silently falls back to the event-driven path (backlog
item 2).

`generateToken` is shared by three of the five routes. It signs a 15-minute HS256 access token and
persists an opaque 64-byte refresh token whose TTL index reaps it after 7 days. The controller
still checks `expiresAt` explicitly because Mongo's reaper runs on roughly a 60-second cycle, so a
just-expired token can still be present in the collection.

## Event paths (`src/eventHandlers/identity-event-handlers.ts`)

This service is the **enrichment authority** — it owns the `Team` collection, so every other
service asks it for team data over the bus rather than reading the database directly.

| Queue | Routing key | Handler | Publishes |
|---|---|---|---|
| `identity.profilePhoto.updated` | `profilePhoto.updated` | `handleProfileUploadEvent` | — (writes `Team.logoUrl`) |
| `identity.fetchTeamDetails` | `fetchTeamDetails` | `handleTeamDetailEvent` | `TeamDetails` |
| `identity.fetchTeamDetailsForMatchInviteCreated` | `fetchTeamDetailsForMatchInviteCreated` | `handleTeamDetailForMatchInviteEvent` | `TeamDetailsForMatchInvite` |
| `identity.fetchTeamDetailsForRespondingToInvite` | `fetchTeamDetailsForRespondingToInvite` | `handleTeamDetailForRespondingToInviteEvent` | `teamDetailsForRespondingToInvite` |

Three of the four are request/response pairs over the bus: match-service publishes a `fetch*` key,
this service answers on a different key, and match-service consumes the answer.

`handleProfileUploadEvent` calls `team.save()`, which fires the pre-save hook — but
`isModified('password')` is false, so the already-hashed password is not re-hashed. That guard is
load-bearing, not defensive.

**All four handlers catch their own errors and return normally**, so `@uff/shared/rabbitmq` acks
the message. The consequence is that the new dead-letter queue is **unreachable from this service**
until those internal try/catch blocks are removed — the DLX only catches failures a handler does
not catch itself. Preserved from the original; backlog item 14.

## What the port changed

- `rabbitmq.js`, `logger.js`, `errorHandler.js` → `@uff/shared`. Behaviour changed only for the
  bus, per D-05.
- `authMiddleware.js` deleted — it was never mounted (D-ID-04).
- `consumeEvent` call sites gained a queue-name argument; anonymous exclusive queues became named
  durable ones. This is the change that stops events being lost while this service is down.
- `GET /health` added — did not previously exist.
- `SIGTERM`/`SIGINT` graceful shutdown added — did not previously exist.
- `uncaughtException` handler added.
- ~100 lines of commented-out rate limiter config removed (D-ID-02).
- Controllers and handlers became factories taking a logger (D-ID-05).
- Pre-save hook rewritten for Mongoose 9's callback-free signature (D-ID-07).
- `getTeamById`'s catch block no longer throws a `ReferenceError` (D-ID-06).

## What the port did NOT change

- The `x-team-id` trust model. This service does not consume it, but the shared middleware
  preserves it for the services that do. Backlog item 1.
- The always-undefined `name` claim in the JWT — signed from `team.name`, but the model field is
  `teamName`. Backlog item 5.
- `login` returning **404** rather than 401 for a bad password.
- `getTeamById` returning the argon2 password hash in its response body.
- `handleTeamDetailEvent` publishing the argon2 password hash onto the event bus.
- `unhandledRejection` logging without exiting.
- The inconsistent routing-key naming (`TeamDetails` vs `teamDetailsForRespondingToInvite` vs
  `profilePhoto.updated`). Backlog item 13.
