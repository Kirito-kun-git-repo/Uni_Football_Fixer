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

## HTTP request paths

Every path below is a proxy. `proxyReqPathResolver` rewrites the public `/v1` prefix to the internal
`/api` prefix — `req.originalUrl.replace(/^\/v1/, '/api')` — and that rewrite is the whole routing
contract. Downstream services mount their routers at `/api/*` and none of them know `/v1` exists.

| Public route | JWT | Target | Rewritten to | Headers injected |
|---|---|---|---|---|
| `GET /health` | ❌ | — | — | terminates here; not proxied |
| `/v1/auth/*` | ❌ | `IDENTITY_SERVICE_URL` | `/api/auth/*` | `Content-Type: application/json` |
| `/v1/media/*` | ✅ `validateToken` | `MEDIA_SERVICE_URL` | `/api/media/*` | `x-team-id`; `Content-Type: application/json` **unless** multipart |
| `/v1/match/*` | ✅ `validateToken` | `MATCH_SERVICE_URL` | `/api/match/*` | `x-team-id`; `Content-Type: application/json` |

`/v1/auth/*` carries **no** `validateToken` because it is where tokens are issued — requiring one
would make login unreachable. The side effect is that `GET /v1/auth/getTeamById/:teamId` is public.
Preserved; backlog item 1.

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
      → proxyReqOptDecorator  x-team-id + Content-Type
      → match-service
      → userResDecorator      log status, return body verbatim
```

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

## What the port changed

- `logger.js`, `errorhandler.js`, `authMiddleware.js` → `@uff/shared`. The gateway's copy of
  `validateToken` is gone; `createValidateToken(env.JWT_SECRET, logger)` replaces it with identical
  status codes and messages.
- `GET /health` added — did not previously exist (issue 7), and sits ahead of the rate limiter so a
  probe cannot exhaust the request budget (D-GW-05).
- `SIGTERM`/`SIGINT` graceful shutdown added — did not previously exist. Exits from inside the
  `server.close` callback so in-flight proxied responses finish (D-GW-10).
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
- **`app.set('trust proxy', 1)` still registered after the rate limiter** (issue 1), so the limiter
  may still key on the load balancer's IP. Deliberate — D-GW-06.
- **The rate limiter itself**: still global, still 100 requests per IP per 15 minutes, still applied
  to `/v1/auth/login` with the same budget as everything else (issue 3). Still the only *active*
  limiter in the system.
- **`logger.info(\`Request Body ${req.body}\`)`**, which has always printed `[object Object]`
  (issue 4). Preserved verbatim, and worth understanding before anyone "fixes" it: serialising that
  object would start writing plaintext passwords from `/v1/auth/login` into the logs.
- **Proxy errors collapsing to `500`** with the upstream status discarded (issue 5).
- **`cors()` with no options** — every origin allowed (issue 6, backlog item 6).
- **Response bodies fully buffered** by `userResDecorator` to log a status code, so large media
  responses are materialised in gateway memory (issue 12).
- **The `x-team-id` trust model** that every downstream service depends on (backlog item 1).
- The original's log wording, typos included — `"  Recieved ..."`, `"Identity Service URL:, ..."`.
  Log lines are something people grep for; changing them silently breaks whatever does.
