# Uni Football Fixer

Inter-college football matches, organised by software instead of by group chat.

A team registers for its college and posts a fixture it wants — time and ground. Other
teams see it and challenge. The host accepts one, and at that moment every losing team
gets a rejection email and both sides get a confirmation. That last part is the point:
on WhatsApp, the teams who didn't get the game simply never find out.

<details>
<summary>Why this exists</summary>

In second year we wanted a match against IIT Ropar, who are near us. Arranging it took:
finding someone in their sports community through Instagram → getting a number for their
sports coordinator → having their coordinator talk to our coordinator → permission granted
on a phone call nobody recorded → only then were we allowed onto their campus to play.

Days of it, and none of it was football. It was discovery, identity, and a paper trail.
So those are the three things this builds.
</details>

---

## Architecture

Five services. Each owns its own MongoDB database — nothing shares a datastore.

```
                        client
                          │
                          │  :3000  ← the only published port
                          ▼
                 ┌──────────────────┐
                 │   api-gateway    │   verifies the JWT (the only place that does)
                 │                  │   rewrites /v1/* → /api/*
                 └────────┬─────────┘   injects x-team-id + x-internal-secret
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
  │   identity   │ │    match     │ │    media     │
  │ teams,tokens │ │fixtures,     │ │ logo uploads │
  │              │ │invites       │ │ → Cloudinary │
  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘
         │                │                │
         └────────────────┼────────────────┘
                          ▼
            ┌──────────────────────────────┐
            │  RabbitMQ  football.events   │  durable topic exchange
            │  8 typed routing keys        │  DLX → football.dlq
            └──────────────┬───────────────┘
                           ▼
                  ┌──────────────────┐
                  │  notification    │ ──SMTP──▶  Mailpit (dev)
                  │  invite / fixed  │            Gmail  (live)
                  └──────────────────┘
```

Synchronous calls go through the gateway. Anything that shouldn't block a request goes
over RabbitMQ. Redis backs the gateway's rate limiter.

**The routing keys are typed.** Publisher and consumer of each key import the same
TypeScript interface from `@uff/shared/events`, so a payload shape that would break a
consumer fails at compile time instead of silently at runtime three services away.

---

## Running it

**Needs:** Docker with Compose v2, and Node 20+ if you want to run the smoke test from
the host.

```bash
cp .env.example .env
# Only JWT_SECRET is mandatory:
#   openssl rand -hex 32
# Cloudinary and Gmail credentials are optional — the stack boots without them,
# and email goes to a local sink by default.

docker compose up -d --build     # ~3 min on a cold build
npm run smoke                    # 21 assertions against the running stack
```

That's it. Nothing else to install, no database to create.

| URL | What |
|---|---|
| http://localhost:3000 | the API — the only published application port |
| http://localhost:8025 | Mailpit — every email the stack sends, readable in a browser |
| http://localhost:15672 | RabbitMQ management (`guest` / `guest`) — queues, and `football.dlq` |

Tear down with `docker compose down`, or `docker compose down -v` to also drop the data.

> **Kernel note.** MongoDB refuses to start on Linux kernel 6.19 and newer
> ([SERVER-121912](https://jira.mongodb.org/browse/SERVER-121912)), so the compose file
> pins `mongo:8.2` rather than bare `mongo:8`. On an older tag the whole stack fails with
> `dependency mongo failed to start`.

---

## The 60-second demo

```bash
npm run smoke
```

Ten numbered stages. The ones labelled **CROSSES RABBITMQ** are the ones that matter —
they assert on a field that a message consumer wrote *after* the HTTP response had
already gone out, so they're the only checks that can detect a broken event handler.
A type checker can't reach across the bus, and the HTTP responses don't reflect it.

Watch it move:

```bash
docker compose logs -f match-service notification-service
```

### Or click through it

Import `postman/Football-Fixer.postman_collection.json` and hit **Run collection** — or
click requests `00` → `10` in order. Each one saves what the next needs (tokens, team id,
match id, invite id), so nothing is copied by hand. 30 assertions, and every request
carries a description explaining what it proves.

The two to stop on:

- **05 → 06.** `create-match` returns with `teamName` **empty**. The same match in
  `get-matches` a moment later **has** it. Nothing in the HTTP path wrote that —
  match-service asked identity-service over the bus and a consumer filled it in. That gap
  is eventual consistency, visible on screen.
- **07 → 07b.** Create an invite, then ask Mailpit whether the mail was actually
  *delivered* — not whether we called our own `sendMail`. That distinction is load-bearing;
  see the known limits below.

---

## API

Everything is behind the gateway on `:3000`. `/v1/*` is public-facing; the services
themselves mount `/api/*` and don't know the `/v1` prefix exists.

| Method | Path | Auth | |
|---|---|---|---|
| `POST` | `/v1/auth/register` | — | `{teamName, collegeName, email, password}` |
| `POST` | `/v1/auth/login` | — | → `accesstoken` (15 min), `refreshtoken` (7 days) |
| `POST` | `/v1/auth/refresh-token` | — | rotates: issues a new pair, deletes the old |
| `POST` | `/v1/auth/logout` | — | deletes the refresh token |
| `GET` | `/v1/auth/getTeamById/:id` | — | ⚠ public — see known limits |
| `POST` | `/v1/match/create-match` | JWT | `{matchTime, location}` |
| `GET` | `/v1/match/get-matches` | JWT | all fixtures |
| `GET` | `/v1/match/get-my-matches/` | JWT | mine |
| `GET` | `/v1/match/:id` | JWT | one fixture |
| `POST` | `/v1/match/send-invite/:matchId` | JWT | challenge a fixture |
| `POST` | `/v1/match/respond-to-invites/:inviteId` | JWT | `{response: "accepted"}` |
| `GET` | `/v1/match/get-all-invites/` | JWT | invites to me |
| `GET` | `/v1/match/get-outgoing-invites/` | JWT | invites from me |
| `POST` | `/v1/media/upload-logo` | JWT | multipart, field `file`, 10 MB cap |
| `GET` | `/v1/media/get` | JWT | ⚠ unfiltered — see known limits |

Emails must have a real TLD — `@example.com` works, `@uff.local` is rejected by Joi.

---

## What's in the repo

| | |
|---|---|
| `docs/DECISIONS.md` | **Every decision, with its reasoning.** Commits cite the ID, so `git log --grep=D-05` returns every line of code a decision produced. Per-service logs live in `<service>/DECISIONS.md`. |
| `docs/architecture/` | As-built notes per service, with numbered known issues |
| `docs/workflow.md` | Branching, review, handover |
| `docs/RENDER-DEPLOY.md` | Deployment blueprint |
| `packages/shared/` | Logger, error handler, auth middleware, RabbitMQ client, **typed event contracts** |
| `scripts/smoke-test.mjs` | The 21 assertions above |
| `scripts/live-test.mjs` | Same flow against *real* Cloudinary and Gmail |
| `postman/` | Importable collection |
| `src/` | The original monolith. Deliberately untouched and excluded from the workspace (`D-02`) — it still holds the Socket.io chat and admin routes, which are a separate porting job. |

Built as three phases: a monolith (Apr 2025), a split into five JavaScript services
(Sep 2025), then a port to TypeScript + ESM with shared contracts, Docker and event-bus
fixes (Aug 2026).

```bash
npm run typecheck     # tsc --noEmit across all six workspaces
npm run build
```

---

## Known limits

Written down because they're real, not because they're theoretical.

**Correctness**

- The accept path does **three writes with no transaction** — Mongo transactions need a
  replica set and this runs a single node. A crash between them leaves an accepted invite
  on an `open` match, or a `matched` match with invites still pending.
- The status guard on accept is a **read-then-write with no lock**. The cheap fix is
  `findOneAndUpdate` on `{_id, status: 'pending'}`, which is atomic on one document.
- `idempotencyKey` and `note` are passed to `MatchInvite.create()` but **aren't schema
  paths**, so Mongoose drops both silently. Duplicate invites are prevented by the unique
  compound index on `{senderTeamId, matchId}` — and a duplicate surfaces as a raw Mongo
  `E11000` in a 500, where it should be a 409.
- Invites have an `expired` status that **nothing ever sets**. No TTL, no scheduler.

**Messaging**

- **No publisher confirms.** The channel is a plain one, so a publish resolves when the
  bytes reach the socket, not when the broker has accepted them. `persistent: true`
  without confirms means "write it to disk if you get it", not "tell me you got it".
- **notification-service can't reach its own DLQ.** The shared client only dead-letters
  when a handler *throws*, and both notification handlers catch and log. A failed send is
  acked and gone.
- Nothing watches `football.dlq`. No depth alert, no redrive.
- No retry or backoff. A transient SMTP failure is treated exactly like a malformed payload.

**Security**

- `GET /v1/auth/getTeamById/:id` is **public** — the whole `/v1/auth/*` prefix is mounted
  without the token check, because that's where tokens come from. It's load-bearing:
  match-service's enrichment calls it back through the gateway with no user token.
- `x-internal-secret` is a single shared bearer value with no rotation. It stops direct-curl
  impersonation; it does not survive an attacker already inside. The real fix is a
  short-lived signed token per request — which also closes the point above.
- `app.set('trust proxy', 1)` with nothing in front to sanitise the header, so a forged
  `X-Forwarded-For` mints a fresh rate-limit bucket. Verified, not assumed.
- The rate limiter is global, so `/v1/auth/login` gets the same generous bucket as
  everything else.
- Email templates interpolate team names into HTML **unescaped** (`D-NT-08`).

**Performance**

- Enrichment on accept is **sequential** — a fixture with N challengers is N round-trips.
- **No indexes on `Match`**, including `teamId` and `status`, which are the only fields
  anything queries by.
- The gateway buffers whole response bodies in memory to log the status code.
- `multer` uses `memoryStorage`, so N concurrent uploads hold N × 10 MB resident. No
  `fileFilter`, and Cloudinary runs with `resource_type: 'auto'`, so any file type is
  accepted as a "logo".

**Testing and ops**

- No unit tests. Verification is `tsc --noEmit` plus the smoke test against a real stack.
- Single replica of everything, no CI, no orchestrator, no tracing.
