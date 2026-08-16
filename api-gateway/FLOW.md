# api-gateway — Execution Flow

How execution actually travels through this service. Companion to
`docs/architecture/01-api-gateway.md`, which describes the service from the outside; this describes
it from the inside.

The gateway owns **no database, no message bus, and no domain logic**. Every request either gets
rejected at the edge or gets forwarded. That makes the middleware chain the entire service.

## Startup order (`src/server.ts`)

`env.ts` loads and validates environment variables **at import time** — a missing variable throws
there, before anything binds a port. This is why `import { env } from './env.js'` is the first line
of `server.ts`: failing at import gives `Missing required environment variable: MATCH_SERVICE_URL`
instead of a route that 500s on its first request three days later (D-GW-02).

1. `createLogger('api-gateway')`
2. `new Redis(env.REDIS_URL)` — constructed early because `RedisStore` closes over it. Backs the
   rate-limit counters and **nothing else**; the gateway stores no data of its own.
3. `helmet()` → `cors()` → `express.json()`
4. `GET /health` registered — **before** the rate limiter, deliberately (D-GW-05)
5. `rateLimit({...})` constructed with a `RedisStore`, then mounted with `app.use` — global
6. request logger (method, url, body)
7. `app.set('trust proxy', 1)` — **after** the limiter, preserved from the original (D-GW-06)
8. `createValidateToken(env.JWT_SECRET, logger)` built once and reused by two of the three proxies
9. the three proxy routes, in order: `/v1/auth`, `/v1/media`, `/v1/match`
10. `createErrorHandler(logger)` registered **last**, after all routes
11. `startServer()` → `app.listen(env.PORT)`

Unlike identity-service, `startServer()` is synchronous and awaits nothing. There is no datastore to
connect before the service can serve traffic — the Redis client connects in the background and the
proxies are stateless. The function exists only because the shutdown wiring needs the server handle.

12. `SIGTERM`/`SIGINT` → `shutdown()`: stop accepting → drain in-flight → disconnect Redis → exit

**Observed at runtime.** The boot log confirms the order above, and confirms that the port really
does bind before Redis is ready:

```
16:07:00.646  API Gateway is running on port 3000
16:07:00.647  Identity Service URL:, http://identity-service:3001
16:07:00.648  Media Service URL http://media-service:3003
16:07:00.648  Match Service URL http://match-service:3004
16:07:00.648  Redis URL:', redis://redis:6379
16:07:00.652  Connected to Redis
```

`Connected to Redis` lands **6 ms after** `listen`, not before it. For that window `/health` returns
`503 {"status":"degraded"}` — the endpoint reports `redisClient.status`, which is `connecting` until
the handshake completes. Compose's `start_period: 20s` absorbs it, so the container never flaps, but
anything that probes the gateway in its first few milliseconds will see a 503. This is inherent to
`startServer()` awaiting nothing, and it is the trade for the gateway being able to proxy before
Redis is up.

No connection retries, no reconnect storms, and no `error` events from the Redis client appear in
the log across the container's lifetime.

## HTTP request paths

Every path below is a proxy. `proxyReqPathResolver` rewrites the public `/v1` prefix to the internal
`/api` prefix — `req.originalUrl.replace(/^\/v1/, '/api')` — and that rewrite is the whole routing
contract. Downstream services mount their routers at `/api/*` and none of them know `/v1` exists.

| Public route | JWT | Target | Rewritten to | Headers injected |
|---|---|---|---|---|
| `GET /health` | ❌ | — | — | terminates here; not proxied; not rate limited |
| `/v1/auth/*` | ❌ | `IDENTITY_SERVICE_URL` | `/api/auth/*` | `Content-Type: application/json` |
| `/v1/media/*` | ✅ `validateToken` | `MEDIA_SERVICE_URL` | `/api/media/*` | `x-team-id`; `Content-Type: application/json` **unless** multipart |
| `/v1/match/*` | ✅ `validateToken` | `MATCH_SERVICE_URL` | `/api/match/*` | `x-team-id`; `Content-Type: application/json` |

`/v1/auth/*` carries **no** `validateToken` because it is where tokens are issued — requiring one
would make login unreachable. The side effect is that `GET /v1/auth/getTeamById/:teamId` is public.
Preserved; backlog item 1.

### `GET /health` — observed output

```
$ curl -s http://localhost:3000/health
{"service":"api-gateway","status":"ok","redis":"ready"}
```

`200` when `redisClient.status === 'ready'`, `503` with `"status":"degraded"` otherwise. Redis is
the only dependency reported, because it is the only one the gateway has — no database, no message
bus, and deliberately **not** the three downstream services. A gateway that reported its upstreams'
health would go unhealthy whenever any one of them did, which is the opposite of what an edge
should do.

The corollary is worth stating: **losing Redis marks the gateway unhealthy even though it can still
proxy every route.** Redis backs rate limiting and nothing else, so a Redis outage degrades the
limiter, not the routing — but the healthcheck (`interval: 10s`, `retries: 10`) will flip the
container to `unhealthy` after ~100s, and anything gating on `service_healthy` would pull a
still-functional gateway out of rotation. Deliberate — a silently unlimited edge is worth
surfacing — but it is a failure amplification, not a containment.

### `validateToken` — the auth boundary

`createValidateToken` from `@uff/shared/auth`. **This is the only JWT signature verification in the
entire system.** No token → `401`; bad signature → `403`; otherwise the decoded payload lands on
`req.team` and the proxies copy `req.team.teamId` into the `x-team-id` request header.

Everything downstream trusts that header unconditionally — no signature, no shared secret. Anyone
who can reach a service port directly bypasses this check entirely. Preserved deliberately; backlog
item 1.

The `srcReq.team!` non-null assertions in `proxies.ts` encode the ordering dependency: `validateToken`
is mounted ahead of the media and match proxies and 401s without a token, so `team` is always
populated by the time a decorator runs. Nothing else in the file assumes it.

### Per-request order for `/v1/match/get-my-matches`

```
helmet → cors → express.json → ratelimit (Redis INCR on req.ip)
      → request logger → validateToken (jwt.verify)
      → proxyReqPathResolver  /v1/match/... → /api/match/...
      → proxyReqOptDecorator  x-team-id + Content-Type, and logs the bare teamId
      → match-service
      → userResDecorator      log status, return body verbatim
```

The match proxy's `logger.info(srcReq.team!.teamId)` emits the team id on a line of its own, with no
label — the `6a81e02efcf35c8a38511319` lines in the log are this, and nothing else in the gateway
produces them. Preserved from the original, but worth knowing two things about it: it is the one
place the gateway writes an account identifier to disk on every request, and because the line has no
message prefix it is invisible to any grep that looks for a keyword.

A transport failure at the upstream hop goes to `proxyErrorHandler`, which logs and returns a flat
`500 { message: 'Internal Server Error' }`. The upstream status is not preserved, so a connection
refusal is indistinguishable from a genuine server error. Preserved; issue 5.

`createErrorHandler` catches everything that is *not* a proxy transport error — a throw in
`validateToken`, a malformed JSON body rejected by `express.json()`. Express 5 funnels async
rejections there automatically, which Express 4 did not.

## Event paths

**None.** The gateway has no RabbitMQ connection, no MongoDB connection, and publishes and consumes
nothing. It is the only service in the system that is purely synchronous. `@uff/shared/rabbitmq` and
`@uff/shared/events` are not imported here, and `consumeEvent` is never called.

That remains true. What is *not* true is the implication that the gateway therefore only ever talks
outward to downstream services — see the next section.

## The gateway is not only an edge — corrected against runtime

Everything above describes the gateway as the system's outer boundary: clients on the outside,
services on the inside. The running stack shows that is only half true. **match-service calls back
*inward* through the gateway.**

`match-service/src/env.ts` carries `GATEWAY_URL` (compose sets it to `http://api-gateway:3000`), and
`match-Invite-Controller.ts` uses it at three call sites to fetch team details:

```
match-service → GET http://api-gateway:3000/v1/auth/getTeamById/:id → identity-service
```

This is visible in the gateway's own log — `getTeamById` lines interleaved with the `send-invite`
and `respond-to-invites` requests that triggered them — and in Redis, where the rate limiter holds a
counter keyed on match-service's container IP:

```
$ docker compose exec redis redis-cli KEYS 'rl:*'
rl:172.19.0.7      <- match-service (4 hits from one smoke-test run)
rl:172.19.0.1      <- host
rl:::/56           <- host over IPv6
```

Two consequences that the "edge-only" framing hides, both confirmed above and neither reachable by
the smoke test:

1. **Internal traffic spends the public rate-limit budget.** The limiter is global and keys on
   `req.ip`, so all of match-service's enrichment lookups share **one** 100-request-per-15-minutes
   bucket for the entire cluster, regardless of how many teams are using the system. Each invite
   sent or answered costs 2 of those. Roughly **50 invite operations in any 15-minute window
   exhausts it**, after which the gateway starts returning `429` to match-service.
2. **That failure is silent.** The lookups sit inside `Promise.allSettled` in
   `match-Invite-Controller.ts`, which never rejects — a `429` becomes a rejected settlement, logs
   `Sender enrichment failed: ...` at `warn`, and the invite notification is published anyway with
   `teamName` and `email` left `undefined`. Nothing 500s and nothing alerts; notifications just
   quietly lose their team names once the budget runs out.

The gateway is not the wrong place to fix this — the limiter should skip internal callers, or
match-service should reach identity-service directly on the `uff` network rather than hairpinning
through the public edge. Both are cross-service changes and are reported to the coordinator rather
than made here.

## The trust-proxy claim was wrong — corrected against runtime

Earlier revisions of this file, and the comment above `app.set('trust proxy', 1)` in `server.ts`,
asserted that registering the setting *after* `app.use(ratelimit)` meant "the limiter may still key
on the load balancer's IP" and called it "a live bug behind a load balancer". **That is not what
happens.** Tested against the running gateway:

```
$ curl -s -D - -H 'X-Forwarded-For: 203.0.113.99' http://127.0.0.1:3000/nope | grep RateLimit-Remaining
RateLimit-Remaining: 99

$ docker compose exec redis redis-cli KEYS 'rl:*'
rl:203.0.113.99    <- a fresh bucket, keyed on the forwarded client IP
```

The limiter keyed on the `X-Forwarded-For` value, not on the connecting IP. Registration order is
irrelevant: `req.ip` is a lazy getter evaluated per request, and `app.set('trust proxy', 1)` runs
during boot — long before any request exists to read it. There is no ordering bug here.

The real consequence runs the other way, and it is worse: **`trust proxy` is enabled with nothing
in front of the gateway to sanitise the header, so any client can reset its own rate-limit bucket by
inventing an `X-Forwarded-For`.** Rotating that header per request bypasses the limiter completely.
Since this is the only active limiter in the system (the other four services have theirs commented
out), the system's entire rate-limiting story is one client-supplied header away from nothing.

Preserved rather than fixed, for the same reason D-GW-06 gave: it is a behaviour change that belongs
with the rate-limiting rework. But it should be recorded as a live security gap, not as a latent
ordering nit — the previous framing understated it.

## What the port changed

- `logger.js`, `errorhandler.js`, `authMiddleware.js` → `@uff/shared`. The gateway's copy of
  `validateToken` is gone; `createValidateToken(env.JWT_SECRET, logger)` replaces it with identical
  status codes and messages.
- `GET /health` added — did not previously exist (issue 7), and sits ahead of the rate limiter so a
  probe cannot exhaust the request budget (D-GW-05).
- `SIGTERM`/`SIGINT` graceful shutdown added — did not previously exist. Exits from inside the
  `server.close` callback so in-flight proxied responses finish (D-GW-10).

  **Verified at runtime.** The signal reaches the handler — `node` runs as **PID 1** in the
  container (`CMD` is exec-form, so no shell swallows the signal) — and the drain completes. The
  teardown of the audited stack is the evidence:

  ```
  $ docker events --filter event=kill --format '{{.Actor.Attributes.name}} signal={{...}}'
  1786897220 uni_football_fixer-api-gateway-1 signal=15
  $ docker events --filter event=die  --format '{{.Actor.Attributes.name}} exitCode={{...}}'
  1786897220 uni_football_fixer-api-gateway-1 exitCode=0
  ```

  `SIGTERM` in, `exitCode=0` out, within the same second. That exit code can only come from the
  `process.exit(0)` inside the `server.close()` callback: had the handler not run or not completed,
  Docker would have waited out the full grace period and killed it, and the die event would read
  `exitCode=137`. The shutdown path works.

  Two edges still bound it, neither disproved by the above — the drain was fast because the gateway
  was idle at teardown:

  - `server.close()` waits for existing connections rather than closing idle ones. Responses carry
    `Keep-Alive: timeout=5`, so an idle client connection holds shutdown open for up to 5s.
    `closeIdleConnections()` is not called.
  - Compose sets no `stop_grace_period`, so Docker's default 10s applies. An idle connection fits
    inside it; a long in-flight response does not necessarily — and because `userResDecorator`
    buffers whole response bodies (issue 12), a large media download is exactly the case that could
    still be in flight at the 10s mark and get `SIGKILL`ed mid-response. There is no forced-exit
    timer in `shutdown()`; the 10s grace period is what bounds it.
- `uncaughtException` and `unhandledRejection` handlers added; the original gateway had neither.
- **The media proxy no longer crashes on a request with no `Content-Type`.** Every `GET` and
  `DELETE` to `/v1/media/*` used to throw a `TypeError` inside `proxyReqOptDecorator` (D-GW-04).
  This is the only intentional behaviour change in the request path.
- Environment variables validated at boot instead of failing per-route at request time (D-GW-02).
- The three near-identical proxy blocks became one factory plus three thin wrappers (D-GW-03).
- The commented-out `/v1/posts` and `/v1/search` proxies deleted (D-GW-09).
- Dockerfile: `node:18-alpine` + `npm ci --only=production` → multi-stage `node:24-alpine` built
  from the repo root (D-GW-08).
- `winston` and `jsonwebtoken` dropped from `package.json` (D-GW-01).

## What the port did NOT change

- **The `/v1` → `/api` rewrite.** Byte-for-byte the same regex.
- **`app.set('trust proxy', 1)` still registered after the rate limiter** (issue 1). Deliberate —
  D-GW-06. See the correction below: the registration order turns out not to matter, but the
  setting itself has a consequence that does.
- **The rate limiter itself**: still global, still 100 requests per IP per 15 minutes, still applied
  to `/v1/auth/login` with the same budget as everything else (issue 3). Still the only *active*
  limiter in the system.
- **`logger.info(\`Request Body ${req.body}\`)`** (issue 4), which prints `[object Object]` for any
  request whose JSON body `express.json()` parsed and `undefined` for bodyless ones. Preserved
  verbatim, and worth understanding before anyone "fixes" it: serialising that object would start
  writing plaintext passwords from `/v1/auth/login` into the logs.
- **Proxy errors collapsing to `500`** with the upstream status discarded (issue 5).
- **`cors()` with no options** — every origin allowed (issue 6, backlog item 6).
- **Response bodies fully buffered** by `userResDecorator` to log a status code, so large media
  responses are materialised in gateway memory (issue 12).
- **The `x-team-id` trust model** that every downstream service depends on (backlog item 1).
- The original's log wording, typos included — `"  Recieved ..."`, `"Identity Service URL:, ..."`.
  Log lines are something people grep for; changing them silently breaks whatever does.
