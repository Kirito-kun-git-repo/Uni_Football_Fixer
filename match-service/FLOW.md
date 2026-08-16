# match-service — Execution Flow

How execution actually travels through this service. Companion to
`docs/architecture/03-match-service.md`, which describes the service from the outside; this
describes it from the inside.

This is the domain core: it owns hosted **matches** and the **invite** workflow (challenge →
accept → auto-reject the rest), and it is the only publisher of `notification` events.

## Startup order (`src/server.ts`)

`env.ts` loads and validates environment variables **at import time** — a missing variable throws
there, before anything connects. That is why `import { env } from './env.js'` is the first line of
`server.ts`: failing at import gives `Missing required environment variable: MONGODB_URL` instead of
an opaque driver timeout thirty seconds later.

1. `createLogger('match-service')`
2. Express middleware, in order: `helmet` → `cors` → `express.json` → request logger
3. `GET /health` registered — reports `mongoose.connection.readyState`. **Registered before the
   auth gate below** (D-MT-09), which is what lets an unauthenticated probe reach it.
4. `createAuthenticateRequest(logger)` mounted **globally**. Every route after this line requires an
   `x-team-id` header, including `get-matches`, documented as the public display board (issue 11).
5. `/api/match` → invite router
6. `/api/match` → match router. **Same prefix, and the order is load-bearing**: the match router
   ends in a `GET /:id` catch-all that would otherwise swallow `/get-all-invites` and
   `/get-outgoing-invites` (issue 16).
7. `createErrorHandler` registered **last**, after all routes.
8. Redis client constructed. **No request path uses it** — it exists only because the original
   server did, and the rate limiters that consumed it are gone (D-MT-03).
9. `startServer()`: Mongo connect → RabbitMQ connect → 3 consumers registered → **then**
   `app.listen`. The original connected to Mongo outside this sequence and never awaited it, so the
   listener could accept a request before the database was up.
10. `SIGTERM`/`SIGINT` → `shutdown()`: stop accepting → close RabbitMQ → close Mongo → disconnect
    Redis.

## HTTP request paths

All arrive from the gateway, which rewrites `/v1/match/*` → `/api/match/*` and injects `x-team-id`.
Everything below `/health` passes `authenticateRequest` first, which trusts that header
unconditionally — no signature, no expiry, no issuer check.

### Invites (`routes/inviteRoutes.ts` → `controllers/match-Invite-Controller.ts`)

| Route | Controller | What it touches, in order |
|---|---|---|
| `POST /api/match/send-invite/:matchId` | `createInvite` | `Match.findById` (404) → `receiverTeamId = match.teamId` → self-challenge guard (403) → `MatchInvite.create(pending)` → **sync enrichment** → publish `notification` → `201 invite` |
| `POST /api/match/respond-to-invites/:inviteId` | `respondToInvite` | `MatchInvite.findById` (404) → receiver-only guard (403) → `pending`-only guard (409) → `'accepted'`-only guard (400) → `invite.save()` → `Match.findByIdAndUpdate(matched)` → `updateMany(others → rejected)` → `distinct('senderTeamId')` → **sync enrichment** → publish `notification` → `200` |
| `GET /api/match/get-all-invites/` | `getIncomingInvites` | `find({receiverTeamId: me}).populate('matchId')` |
| `GET /api/match/get-outgoing-invites/` | `getOutgoingInvites` | `find({senderTeamId: me}).populate('matchId')` |

`respondToInvite`'s three writes — invite, match, other invites — are **not transactional**
(issue 8). A crash between them leaves an accepted invite against an `open` match, or a `matched`
match with other invites still `pending`.

### Matches (`routes/matchRoutes.ts` → `controllers/match-Controller.ts`)

| Route | Controller | What it touches, in order |
|---|---|---|
| `POST /api/match/create-match` | `createMatch` | `Match.create({teamId, matchTime, location})` → publish `fetchTeamDetails` → `201` |
| `GET /api/match/get-matches` | `getAllMatches` | `Match.find()` — every match, every status, unpaginated (issue 12) |
| `GET /api/match/get-my-matches/` | `getMyMatches` | `Match.find({teamId: x-team-id})` |
| `GET /api/match/:id` | `getMatchById` | `Match.findById` — `200` with a `null` body for an unknown id (issue 15) |

`createMatch` and `getMyMatches` read `x-team-id` straight off the headers; the invite controller
reads `req.team.teamId`, which `authenticateRequest` populated from the same header. Both are the
same value by different routes, and both are preserved as written.

## The dual-path enrichment

Team names and emails live in identity-service. This service reaches them **two different ways for
every flow**, with different payload shapes — D-05 keeps both, backlog item 2 tracks collapsing
them.

- **Path A, synchronous:** `axios.get(`${env.GATEWAY_URL}/v1/auth/getTeamById/:id`)`, which points
  at the *gateway*, not the service (D-MT-02).
- **Path B, asynchronous fallback:** publish a `fetch…` key, identity-service answers on a
  `…Details` key, a local consumer finishes the job.

| Flow | Path A shape | Path B trigger | Path B shape |
|---|---|---|---|
| `createMatch` | **commented out in the original — never runs** | always (`teamData` is permanently null) | `fetchTeamDetails` → `TeamDetails` → `handleTeamDetailEvent` writes `teamName`/`collegeName` onto the Match |
| `createInvite` | `Promise.allSettled` of two lookups, 700 ms timeout → publishes `notification` **without `purpose`** | only if `publishEvent` throws — `allSettled` never rejects (issue 6) | `fetchTeamDetailsForMatchInviteCreated` → `TeamDetailsForMatchInvite` → `handleTeamDetailForMatchInviteEvent` republishes **with `purpose: 'invite'`** |
| `respondToInvite` | sequential lookups, **no timeout**, one per team → publishes `notification` with `purpose: 'match.fixed'` | only if the outer try throws — the inner per-team try swallows failures (issue 10) | `fetchTeamDetailsForRespondingToInvite` → `teamDetailsForRespondingToInvite` → `handleTeamDetailForRespondingToInviteEvent` regroups by role and republishes with `purpose: 'match.fixed'` |

**The single most important line in this service is one that does nothing.** In `createInvite`'s
payload, `// purpose:'invite',` is commented out. notification-service switches on `event.purpose`,
so this payload falls through to its `default:` branch and **no invite email is ever sent along the
synchronous path** — only along the fallback, which sets it (issue 3). It stays commented out: it
is the defect, and the port records defects rather than fixing them.

Even the fallback does not deliver, for a second reason: what it forwards is a team projection, not
the `{sender, receiver}` shape the consumer reads, so `handleInvite` throws on `hostTeam.email`
(issue 4). Both shapes are recorded under D-MT-04.

## Event paths (`src/eventHandlers/match-event-handlers.ts`)

### Published

| Routing key | From | Payload |
|---|---|---|
| `fetchTeamDetails` | `createMatch` | `{ teamId, matchId }` |
| `fetchTeamDetailsForMatchInviteCreated` | `createInvite` (fallback) | `{ receiverTeamId, matchId }` |
| `fetchTeamDetailsForRespondingToInvite` | `respondToInvite` (fallback) | `{ matchId, inviteId, purpose: 'responding.to.invites', teams: [{teamId, role}] }` |
| `notification` | `createInvite`, `respondToInvite`, and two of the three handlers below | four different shapes — see D-MT-04 |

### Consumed

| Queue | Routing key | Handler | Effect |
|---|---|---|---|
| `match.TeamDetails` | `TeamDetails` | `handleTeamDetailEvent` | writes `teamName`/`collegeName` onto the `Match` |
| `match.TeamDetailsForMatchInvite` | `TeamDetailsForMatchInvite` | `handleTeamDetailForMatchInviteEvent` | adds `purpose: 'invite'`, republishes as `notification` |
| `match.teamDetailsForRespondingToInvite` | `teamDetailsForRespondingToInvite` | `handleTeamDetailForRespondingToInviteEvent` | regroups `enrichedTeams` by role into `{acceptedTeam, hostTeam, rejectedTeams}`, adds `purpose: 'match.fixed'`, republishes as `notification` |

`handleTeamDetailEvent` is the **only** mechanism that ever fills a Match's `teamName` and
`collegeName`, because `createMatch`'s synchronous lookup is commented out. A `201` from
`create-match` therefore always carries `teamName: undefined`, populated milliseconds later.

**All three handlers catch their own errors and return normally**, so `@uff/shared/rabbitmq` acks
the message. The consequence is that the new dead-letter queue is **unreachable from this service**
until those internal try/catch blocks are removed — the DLX only catches failures a handler does not
catch itself. Same situation as identity-service; backlog item 14.

## What the port changed

- `rabbitmq.js`, `logger.js`, `errorHandler.js`, `authMiddleware.js` → `@uff/shared`. Behaviour
  changed only for the bus, per D-05.
- `consumeEvent` call sites gained a queue-name argument; the three anonymous exclusive queues
  became `match.TeamDetails`, `match.TeamDetailsForMatchInvite` and
  `match.teamDetailsForRespondingToInvite`. This is what stops events being lost while this service
  is down, and stops two replicas each processing every message.
- `mongoose` declared in `package.json` for the first time — it was a phantom dependency resolving
  via hoisting, and moves 8 → 9 (D-MT-01).
- `http://localhost:3000` → `env.GATEWAY_URL`, same default (D-MT-02).
- `GET /health` added, ahead of the global auth gate (D-MT-09).
- `SIGTERM`/`SIGINT` graceful shutdown added; `uncaughtException` handler added.
- Mongo connect moved inside `startServer` and awaited, so the listener no longer starts before the
  database is reachable.
- A `Dockerfile` added — this service had none (D-MT-11).
- ~100 lines of commented-out rate-limiter config and six unused dependencies removed (D-MT-03).
- `new Redis({url})` → `new Redis(env.REDIS_URL)`; the client is unused either way (D-MT-03).
- Controllers, routers and handlers became factories taking a logger.
- Two `console.log` calls and one stale startup log removed (D-MT-10).
- The `typeof event === "string"` JSON.parse branch in the batch handler dropped as unreachable
  (D-MT-07).

## What the port did NOT change

- **The commented-out `purpose: 'invite'` in `createInvite`.** Still commented out. It is why the
  synchronous invite path never produces an email (issue 3).
- Both enrichment paths, both of their payload shapes, and the asymmetry that one publishes
  `purpose` and the other does not (D-05, backlog item 2).
- The three `notification` payloads that do not match the shared contracts — reproduced as-is and
  reported rather than patched into `packages/shared` (D-MT-04).
- The `x-team-id` trust model, applied globally, including on the "public" display board
  (issue 11 / backlog item 1).
- `Promise.allSettled` never rejecting, so `createInvite`'s fallback is unreachable for enrichment
  failures (issue 6); and the inner per-team try in `respondToInvite` that has the same effect
  (issue 10).
- `note` and `idempotencyKey` still passed to `MatchInvite.create()` and still dropped; still no
  idempotency (issue 7, D-MT-05).
- The three non-transactional writes in the accept flow (issue 8).
- Sequential, timeout-free axios calls inside `respondToInvite`, so latency still scales with the
  number of invites (issue 9).
- `getAllMatches` returning every match unpaginated (issue 12); `getMatchById` returning `200` with
  a `null` body (issue 15).
- No indexes on `Match.teamId` or `Match.status` (issue 13, D-MT-08).
- `respondedAt` never written and no decline endpoint (issue 14); `expired` in the enum with nothing
  to set it (issue 17).
- Two routers on the same `/api/match` prefix (issue 16).
- `rejectedTeamIds` computed with `!==` — correct today because both sides are Strings, and left
  exactly as written because it decides who gets a rejection email (D-MT-06).
- The `correlationId` set on the invite notification and read by nobody (backlog item 8).
- `unhandledRejection` logging without exiting.
