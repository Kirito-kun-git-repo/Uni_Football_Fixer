# match-service — Decision Log

Service-level decisions from the TypeScript port. Root decisions live in `docs/DECISIONS.md`.
Commits cite these IDs, so `git log --grep=D-MT-04` returns the code a decision produced.

## D-MT-01 — `mongoose` declared explicitly

**Decision:** added `"mongoose": "^9.9.2"` (D-10) to `package.json`.

**Why:** the service imported `mongoose` in both models and `server.js` but never declared it. It
resolved only because npm hoisted the legacy monolith's copy to the repo root — which means
`npm ci` in a clean container produced `MODULE_NOT_FOUND`, and the version the service actually ran
against was whatever the monolith happened to pin (8.13.2 at the root, 8.24.3 as installed). This is
the phantom dependency from `docs/architecture/03-match-service.md` issue 1, and it is why this
service could not be containerised before now.

**Consequence:** the service moves from Mongoose 8 to 9, so D-ID-07 applies here — except that
neither schema in this service has a pre-save hook, so nothing needed rewriting.

## D-MT-02 — `GATEWAY_URL` replaces the hardcoded `http://localhost:3000`

**Decision:** three axios call sites now read `env.GATEWAY_URL`, which defaults to
`http://localhost:3000` — byte-identical to what was hardcoded.

**Why:** behaviour outside a container is unchanged, but the value becomes overridable, which is
what makes the service reachable under docker-compose in Phase 2. Preserving the default rather than
picking a "better" one keeps this a language change, not a behaviour change.

**Not changed:** the URL still points at the **gateway**, not at identity-service, so enrichment
re-enters the public edge, adds a hop, and spends the gateway's rate-limit budget. Those calls also
carry no `Authorization` header and work only because `/v1/auth/*` is unauthenticated. Issue 5 /
backlog item 3.

## D-MT-03 — Dropped the rate limiters and the other unused dependencies; kept a vestigial Redis client

**Decision:** removed `express-rate-limit`, `rate-limit-redis`, `rate-limiter-flexible`, `redis`,
`jsonwebtoken`, `express-http-proxy`, `nodemon`, plus `winston` and `amqplib` (now reached through
`@uff/shared`). Kept `ioredis` and the client `server.ts` constructs.

**Why:** ~100 lines of commented-out limiter config plus one `RateLimiterRedis` instance that was
constructed and never applied to a route — removing it changes no observable behaviour, matching
D-ID-02. `jsonwebtoken` and `express-http-proxy` were installed but never imported: auth here is
header-trust only. `redis` was installed alongside `ioredis`; only `ioredis` was ever used.

**Why the Redis client stays:** the original opened a Redis connection at startup and logged
`Connected to Redis`. Nothing in the request path uses it, but removing it would change what the
service does on boot and what `REDIS_URL` is for. Kept for the same reason identity-service kept
its own. Note `docs/DECISIONS.md` D-ID-08 describes match-service as not touching Redis — that
parenthetical is inaccurate; this service constructs a client exactly like the other four.

**One correction inside that:** the original wrote `new Redis({ url: process.env.REDIS_URL })`.
ioredis has no `url` option — it ignored the object and connected to `localhost:6379`. ioredis 6's
`RedisOptions` type rejects the key outright, so this is now `new Redis(env.REDIS_URL)`, matching
identity-service. The client is unused, so nothing observable depends on which host it reaches.

**Risk:** re-enabling rate limiting later means re-adding a dependency. Backlog item 7.

## D-MT-04 — Three `notification` payloads the shared contracts do not describe

**Decision:** reproduced what the code sends today and cast at the call site.
`packages/shared` was NOT edited, and none of the contracts were widened.
**All three are reported back for the Phase 2 integrator to resolve.**

| # | Where | Contract says | Code sends |
|---|---|---|---|
| 1 | `match-event-handlers.ts` → `handleTeamDetailForMatchInviteEvent` | `notification` is `InviteNotification \| MatchFixedNotification` | the `TeamDetailsForMatchInvite` team projection (`_id`, `teamName`, `email`, `collegeName`, `matchId`) plus `purpose: 'invite'` — matching neither union member |
| 2 | `match-event-handlers.ts` → `handleTeamDetailForRespondingToInviteEvent` | `acceptedTeam?: EnrichedTeam`, `hostTeam?: EnrichedTeam` (key absent) | explicit `null` for both when a role produced no team (key present, valued null) |
| 3 | `match-Invite-Controller.ts` → `createInvite` | `InviteNotification.createdAt: string`, required | `undefined` — `MatchInvite` has `sentAt` and no `timestamps: true`, so there is no `createdAt` path and `JSON.stringify` drops the key entirely |

**Why not widen the contracts:** four worktrees editing `packages/shared` is the one failure mode
that poisons every branch at once and stays invisible until merge. And mismatch 1 is not a typing
gap — it is architecture-doc issue 4, the live reason invite emails fail even on the fallback path.
Encoding it into the contract would convert a recorded defect into a sanctioned shape.

**How it is visible in the code:** mismatch 2 has a local interface
(`MatchFixedNotificationAsPublished`) declaring the shape actually published, so the divergence is
readable at the call site instead of buried inside a cast. Mismatches 1 and 3 carry the reasoning
in a comment at the exact line.

## D-MT-05 — `note` and `idempotencyKey` NOT added to the `MatchInvite` schema

**Decision:** `createInvite` still passes both to `MatchInvite.create()`; the schema still declares
neither, so Mongoose still drops both silently.

**Why:** adding them would start persisting fields this service has never persisted, and would
change the document shape every existing invite read returns. It also would not fix anything:
`idempotencyKey` provides no idempotency whether stored or not — the unique index on
`{senderTeamId, matchId}` is what actually prevents duplicate invites. Issue 7.

**Visible consequence, preserved:** the `notification` payload reads `newInvite.note` back off the
created document, which is always `undefined`, so `note` is always published as `null` — even when
the client supplied one.

**Typing note:** Mongoose's `create()` rejects the two extra keys as excess properties on an object
literal, so the argument is built as a variable first. That is a TypeScript mechanic, not a
behaviour change: the keys are still passed and still dropped.

## D-MT-06 — `rejectedTeamIds` comparison semantics preserved

**Decision:** `senderTeamIds.filter(id => id !== acceptedTeamId)` is unchanged.

**What was found:** the concern was that this compares ObjectIds by reference. It does not —
`MatchInvite.senderTeamId` is declared `String` in the schema, so `.distinct('senderTeamId')`
returns strings and `invite.senderTeamId` is a string. `!==` therefore compares by value and the
filter is correct today. Under `strict` it types cleanly with no assertion once the `distinct`
generic is left to infer the field name (`distinct<string>` widens `DocKey` to `string`, which
collapses the result to `unknown[]` — the explicit generic is the thing that breaks it).

**Why it still matters:** this line decides who receives a "your challenge was rejected" email. It
would start silently rejecting nobody if either field were ever migrated to `ObjectId`, because the
comparison would become reference equality on distinct instances. Recorded, not changed.

## D-MT-07 — Which unreachable branches were kept and which were dropped

**Kept**, because they are the documented contract of an endpoint and would come back to life if
the global auth middleware ever moved:

- `createMatch` / `getMyMatches`: the `!teamId` → 400 check. `authenticateRequest` already 401s a
  missing or non-string `x-team-id`, so it cannot fire today.
- `createInvite`, `respondToInvite`, both invite getters: the `!teamId` → 401 checks, same reason.
- `createInvite`'s outer `try` around `Promise.allSettled`, which never rejects — so the async
  fallback is reachable only if `publishEvent` itself throws (issue 6). The dead resilience path is
  the whole point of the dual-path design being on the backlog.
- `respondToInvite`'s per-team inner `try`, which swallows enrichment failures and thereby keeps
  the batched async path effectively dead (issue 10).

**Dropped:** `handleTeamDetailForRespondingToInviteEvent`'s `typeof event === "string"` JSON.parse
branch. `@uff/shared/rabbitmq` parses before invoking the handler, so the handler never sees a
string; under `strict` the branch narrows to `never` and cannot be written as a type test at all.

**Non-null assertions** were used in exactly the places where the original dereferenced a
possibly-null value unguarded — `req.team!.teamId` and `match!._id` after `findByIdAndUpdate`. Each
carries a comment. They preserve the original failure mode precisely: a `TypeError` into the
enclosing catch and a 500, rather than a new guard that would return a different status.

## D-MT-08 — No indexes added to `Match`

**Decision:** `teamId` and `status` remain unindexed.

**Why:** both are the hottest query fields (`getMyMatches`, and any status filter), so an index is
the obvious improvement — which is why it is a performance change and not a port. Adding one alters
query plans and index-build behaviour on a live collection. Issue 13, left on the backlog.

## D-MT-09 — `GET /health` is registered before the global auth gate

**Decision:** `/health` sits above `app.use(createAuthenticateRequest(logger))`.

**Why:** `authenticateRequest` is mounted globally in this service — unlike identity-service, which
has no auth middleware at all — so a probe registered after it would need an `x-team-id` header, and
docker-compose's health check has none. Every other route stays behind the gate, including
`get-matches`, which the architecture doc calls the public display board and which has required
auth all along (issue 11). That stays broken deliberately; only the new endpoint is exempt.

## D-MT-10 — Startup logging tidied

**Decision:** dropped `console.log("match route applied")` (duplicated by the `logger.info` on the
next line) and `console.log(typeof(data))` in the invite handler; dropped
`logger.info("sensitive route applied")`, which announced the rate-limiter block removed in D-MT-03.
Kept `logger.info('match route applied')` and `logger.info('Invites routes loaded')`.

**Why:** `console.log` bypasses winston entirely, so those lines were unstructured and unlabelled in
an otherwise JSON log stream (issue 19). The "sensitive route applied" line described code that no
longer exists.

**Kept deliberately:** the request logger's ``logger.info(`Request Body ${req.body}`)``, which
prints `[object Object]`. It is useless but it is behaviour, and something may be grepping for it.

## D-MT-11 — Dockerfile added; copies all six workspace manifests

**Decision:** new multi-stage `node:24-alpine` build, from the **repo root** context, matching
`identity-service/Dockerfile` (D-ID-09). This service had no Dockerfile at all (issue 2).

**Why all six manifests:** `npm ci` validates `package-lock.json` against every workspace declared
in the root `package.json`; omitting the un-ported services fails the install even though they are
not part of this image. Only `packages/shared` and `match-service` are installed and only their
`dist/` is copied into the runtime stage. `--include-workspace-root` is deliberately not passed —
that would pull the legacy monolith's Express 4 tree into the image.

**Prerequisite:** the image builds only against a root lockfile that knows about this service's new
dependencies. Per the Phase 1 rules no agent commits a lockfile, so the build works on this branch
only after Phase 2 regenerates it. Verified here against a locally regenerated (uncommitted)
lockfile: `docker build -f match-service/Dockerfile .` succeeds and the image compiles both
workspaces.

## D-MT-12 — The one un-awaited `publishEvent` is preserved

**Decision:** `handleTeamDetailForMatchInviteEvent` still does not await its publish; it is written
`void publishEvent(...)` so the omission is explicit rather than accidental. The other two handlers
await theirs, as they did before.

**Why:** `publishEvent` reaches `channel.publish` before its first suspension point, so the message
is on the wire before the shared client acks either way — the ordering is safe. The only difference
is where a failure surfaces: un-awaited it becomes an `unhandledRejection` (logged, not fatal),
awaited it would be caught and logged by the handler's own `catch`. Awaiting is marginally better,
which is exactly why it is a behaviour change and not a port. Recorded so it is a known asymmetry.
