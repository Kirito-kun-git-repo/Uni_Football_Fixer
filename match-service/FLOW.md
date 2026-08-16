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
3. `GET /health` registered — reports `mongoose.connection.readyState`, and **nothing else**.
   **Registered before the auth gate below** (D-MT-09), which is what lets an unauthenticated probe
   reach it. Note what it does not cover: RabbitMQ and Redis are invisible to it, so the container
   reports `healthy` whether or not the bus is reachable. See "Fragility observed at runtime".
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
10. `SIGTERM`/`SIGINT` → `shutdown()`: re-entry guard → stop accepting → drop idle keep-alives →
    **await** in-flight responses → close RabbitMQ → close Mongo → disconnect Redis →
    `process.exit(0)`, under an 8s deadline.

    **Fixed after the runtime audit; see "Post-audit fixes".** It previously stopped accepting but
    did not drain: `server.close()`'s callback was never awaited and `process.exit(0)` ran
    unconditionally, so an in-flight response raced the exit. It also had no try/catch while being
    invoked as `void shutdown(...)`, so a rejecting close landed in `unhandledRejection` — which logs
    without exiting — and the process sat until Docker's SIGKILL.

    The deadline is 8s against Docker's 10s default grace period, so this process picks its own exit
    code rather than being SIGKILLed mid-close. `server.closeIdleConnections()` is the load-bearing
    call: without it, `close()` waits on keep-alive sockets parked between requests — exactly what
    the gateway holds — and would reach the deadline on every shutdown.

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
  at the *gateway*, not the service (D-MT-02). Under compose this closes a **dependency cycle**:
  `api-gateway` waits on `match-service: service_healthy` before starting, while match-service's
  enrichment calls back into the gateway. Match-service is therefore reported healthy during a
  window in which Path A cannot succeed — `ECONNREFUSED` well inside the 700 ms timeout, which
  `Promise.allSettled` then swallows (issue 6). Verified live: the endpoint is reachable at
  `http://api-gateway:3000` once the stack is up, and both invite lookups returned enriched teams.
- **Path B, asynchronous fallback:** publish a `fetch…` key, identity-service answers on a
  `…Details` key, a local consumer finishes the job.

| Flow | Path A shape | Path B trigger | Path B shape |
|---|---|---|---|
| `createMatch` | **commented out in the original — never runs** | always (`teamData` is permanently null) | `fetchTeamDetails` → `TeamDetails` → `handleTeamDetailEvent` writes `teamName`/`collegeName` onto the Match |
| `createInvite` | `Promise.allSettled` of two lookups, `env.ENRICHMENT_TIMEOUT_MS` (was a hardcoded 700 ms) → publishes `notification` **without `purpose`** | only if `publishEvent` throws — `allSettled` never rejects (issue 6) | `fetchTeamDetailsForMatchInviteCreated` → `TeamDetailsForMatchInvite` → `handleTeamDetailForMatchInviteEvent` republishes **with `purpose: 'invite'`** |
| `respondToInvite` | sequential lookups, one per team, each bounded by `env.ENRICHMENT_TIMEOUT_MS` (previously **no timeout at all**) → publishes `notification` with `purpose: 'match.fixed'` | only if the outer try throws — the inner per-team try swallows failures (issue 10) | `fetchTeamDetailsForRespondingToInvite` → `teamDetailsForRespondingToInvite` → `handleTeamDetailForRespondingToInviteEvent` regroups by role and republishes with `purpose: 'match.fixed'` |

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
the message. The consequence is that the new dead-letter queue is **unreachable via handler
failures** until those internal try/catch blocks are removed — the DLX only catches failures a
handler does not catch itself. Same situation as identity-service; backlog item 14.

Two corrections to that, both from reading the shared client rather than the handlers:

- It is not *entirely* unreachable. `JSON.parse` runs inside `consumeEvent`'s try, **before** the
  handler, so a message whose body is not valid JSON nacks without requeue and does reach
  `football.dlq`. Only handler-level failures are swallowed.
- `handleTeamDetailForMatchInviteEvent` used to publish with `void publishEvent(...)`, unawaited —
  the only such call site in the repo. A publish failure there did not reach its own catch: it
  surfaced as an `unhandledRejection`, which this service logs without exiting, so a dropped
  notification was recorded as a stray rejection rather than a handler error. **Now awaited**,
  consistent with the other two handlers. See "Post-audit fixes".

Observed live: `football.dlq` holds 0 messages, and all three consumer queues are durable with
exactly one consumer each.

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
- Sequential axios calls inside `respondToInvite`, so latency still scales with the number of
  invites (issue 9). They are no longer timeout-free — see "Post-audit fixes" — but they are still
  sequential, so the worst case is now bounded at `teams × ENRICHMENT_TIMEOUT_MS` rather than
  unbounded. Making them concurrent is the remaining half of issue 9.
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

## Verified against the running stack

Audited against the live compose stack (`uni_football_fixer`), the full container log plus direct
probes from inside the container. These observations are of the **pre-fix** build (`7fd2b02`) — they
are what prompted "Post-audit fixes" below, and the four items fixed there no longer behave as
described here. Everything else in this section was re-confirmed by the 19/19 smoke run against the
rebuilt images. Everything above was checked; what follows is what the runtime actually showed. **No `error`-level line and no stack trace appeared** across the whole log —
startup, the smoke-test traffic, and the audit's own probes. The only non-`info` output was one
Mongoose deprecation warning on stderr (below) and four `warn: Access attempted without team ID`
lines, all four produced by this audit deliberately calling protected routes without the header.

Confirmed as documented:

- Startup sequence, in order: `Invites routes loaded` → `match route applied` → `Connected to Redis`
  → `Connected to MongoDB` → `Connected to RabbitMQ` → three `Subscribed to …` lines → `Server is
  running on port 3004`. The listener really does come up last.
- `GET /health` → `200 {"service":"match-service","status":"ok","mongo":1}`, and it answers with no
  `x-team-id` header. Docker's healthcheck has passed every probe since start.
- The global auth gate: `get-matches`, `get-all-invites/`, `get-outgoing-invites/` and `/:id` all
  return `401` without the header — including the "public display board" (issue 11).
- Router ordering holds: with the header, `get-all-invites/` returns the invite list rather than
  being swallowed by `GET /:id` (issue 16).
- `GET /:id` for an unknown id returns `200` with a body of `null` (issue 15).
- The `createMatch` enrichment lag is observable: `get-my-matches` immediately after `201` returned
  the match with no `teamName`; half a second later, after `TeamDetails` landed, the same query
  returned it with `teamName` and `collegeName` filled in.
- `createInvite` published `notification` with `sender`/`receiver` fully enriched and **no
  `purpose`** — issue 3, live. `respondToInvite` published `{acceptedTeam, hostTeam, rejectedTeams,
  purpose: 'match.fixed'}`.
- All four published routing keys have a bound durable consumer queue: `fetchTeamDetails`,
  `fetchTeamDetailsForMatchInviteCreated` and `fetchTeamDetailsForRespondingToInvite` on
  identity-service, `notification` on notification-service. Nothing this service publishes is
  unrouted.

Cosmetic log defects, all reproduced from the original (they appear in the pre-port `error.log`
committed at `2e21110`, so they are not port regressions):

- `Request Body [object Object]` on every request — winston does not interpolate an object into a
  template string (issue 19).
- `logger.info('Updated the match with id ', matchId)` passes a string where winston expects
  metadata, so the id is spread character-by-character into `{"0":"6","1":"a",…}`.
- `getMyMatches` logs every matching match document at `info` on every request.
- Mongoose emits one deprecation warning at first use: the `new` option for `findOneAndUpdate()` in
  `respondToInvite`. Behaviour is unaffected today; `returnDocument: 'after'` is the replacement.

## Fragility observed at runtime

Things that work in the current stack but rest on assumptions the code does not enforce.

1. **The bus has no reconnect, and `/health` cannot see it.** `@uff/shared/rabbitmq` logs
   `connection.on('close')` and does nothing else — there is no retry. If RabbitMQ restarts, the
   cached channel stays non-null but dead: `publishEvent` throws on a closed channel and all three
   consumers are gone for good. Meanwhile `/health` only reads `mongoose.connection.readyState`, so
   the container keeps reporting `healthy` while every event path is silently mute, and
   `restart: unless-stopped` never fires because the process has not exited. This is the single
   largest gap between what the service reports and what it can do. Not reproduced live — doing so
   means restarting RabbitMQ under a shared stack — but it follows directly from the shared client,
   which contains no reconnect path.
2. ~~**Shutdown does not drain and can hang.**~~ **Fixed** — see startup step 10 and "Post-audit
   fixes".
3. **Enrichment depends on the gateway, which depends on this service being healthy.** The cycle is
   benign once the stack is warm and invisible while it is not. Not a boot deadlock: this service's
   health probe does not touch the gateway, so the ordering resolves on its own. Left as-is —
   `docker-compose.yml` is outside this service's boundary.
4. **`GET /v1/auth/getTeamById/:id` — the endpoint both enrichment paths call — returns the full
   team document including the argon2 password hash, with no authentication, on the published
   gateway port.** That hash consequently lands in this service's stdout: `handleTeamDetailEvent`
   logs its whole event payload, and the `TeamDetails` event carries the same full document. The
   invite/match-fixed notifications this service publishes are unaffected — they copy only
   `teamName`, `email` and `collegeName`. The fix belongs in identity-service's projection, not
   here; reported to the coordinator rather than patched locally, since redacting the log line would
   leave the hash on the bus and at the public edge.
5. ~~**`createInvite`'s 700 ms enrichment budget covers two sequential network hops**~~ (match →
   gateway → identity → Mongo, twice, in parallel). **Raised and made tunable** — see "Post-audit
   fixes". The underlying behaviour is unchanged: when the budget does blow, `allSettled` means the
   invite is still created and a `notification` still published, just with `teamId`-only teams
   (issue 6). A bigger budget makes that outcome rarer, not impossible.
6. ~~**`respondToInvite` has no timeout at all**~~ on its per-team lookups. **Fixed.** It still does
   them sequentially while an HTTP client waits, so the remaining exposure is
   `teams × ENRICHMENT_TIMEOUT_MS` rather than the unbounded hang it was (issue 9).

## Post-audit fixes

Everything above this section describes a port whose governing rule was *reproduce the original,
report defects rather than fix them*. These four changes are the first deliberate departures from
it, made after the runtime audit and authorised explicitly — three by the user, and the fourth
(`await publishEvent`) by the coordinator. **All four are built, exercised and covered by
`verified/smoke-19-of-19` at `5e19435`.**

| # | Change | Files | Why it is not just a port |
|---|---|---|---|
| 1 | Shutdown drains, guards re-entry, catches its own failures, and exits under an 8s deadline | `src/server.ts` | The old path claimed to be graceful and was not. Everything else here is a behaviour the original *had*; this is a behaviour it only *claimed*. |
| 2 | `ENRICHMENT_TIMEOUT_MS` (default 2500, env-overridable) replaces `createInvite`'s hardcoded 700 ms | `src/env.ts`, `src/controllers/match-Invite-Controller.ts` | Changes how often the degraded `teamId`-only notification is published. Fewer degraded payloads, slower worst-case invite response. |
| 3 | The same deadline applied to `respondToInvite`'s per-team lookups, which had none | `src/controllers/match-Invite-Controller.ts` | Converts an unbounded hang into a bounded failure. The failure itself is still swallowed per team (issue 10), unchanged. |
| 4 | `void publishEvent(...)` → `await publishEvent(...)` in `handleTeamDetailForMatchInviteEvent` | `src/eventHandlers/match-event-handlers.ts` | The only unawaited publish in the repo. Routes a failed publish into the handler's own catch instead of `unhandledRejection`. |

What was deliberately **not** touched while doing this:

- **Issue 6 stays.** `Promise.allSettled` still never rejects, so `createInvite`'s asynchronous
  fallback is still unreachable on enrichment failure. Making it reachable would start exercising a
  fallback that publishes a payload notification-service throws on (issue 4) — "fixing" it would
  turn a silent degradation into a downstream crash. It needs issue 4 fixed first.
- **Issue 9's other half stays.** The lookups are bounded but still sequential.
- **The commented-out `purpose: 'invite'` stays commented out** (issue 3), along with every other
  defect listed under "What the port did NOT change".

**Verification status: built and exercised.** Written under a typecheck-only caveat — the stack was
down at the time — and since rebuilt and smoke-tested at `5e19435`, 19/19 including both
RabbitMQ-crossing assertions, DLQ 0, the three consumer queues intact across the stop/start.

The shutdown path met its acceptance criterion on the first `docker compose stop match-service`,
with the gateway holding keep-alive sockets open from a completed smoke run:

```
info: SIGTERM received, shutting down
info: HTTP server closed
warn: RabbitMQ connection closed
info: RabbitMQ connection closed cleanly
info: Shutdown complete
```

0.19s wall, and no `Shutdown exceeded 8000ms, forcing exit` — so `closeIdleConnections()` did the
work it was added for. That was the failure mode worth guarding against: without it the drain looks
correct in review and rides to the deadline on every stop, because parked keep-alive sockets keep
`close()` pending. Measured now, not reasoned.

**Still unproven:** the drain was exercised against *idle* keep-alive connections, not against a
genuinely in-flight request suspended mid-handler. That is the case the 8s deadline exists for, and
nothing has tested it.
