# api-gateway — Decision Log

Service-level decisions from the TypeScript port. Root decisions live in `docs/DECISIONS.md`.
Commits cite these IDs, so `git log --grep=D-GW-04` returns the code a decision produced.

## D-GW-01 — Kept the rate-limiting dependencies

**Decision:** `express-rate-limit`, `rate-limit-redis` and `ioredis` stay in `package.json`.
`winston` and `jsonwebtoken` are removed.

**Why:** this is the opposite call to D-ID-02, and deliberately so. identity-service dropped its
rate limiters because every one of them was commented out. The gateway's limiter is **the only
active one in the system** — it is constructed, it is passed a `RedisStore`, and it is mounted with
`app.use`. Removing it would remove real behaviour.

`winston` and `jsonwebtoken` go because they are now reached only through `@uff/shared/logger` and
`@uff/shared/auth`. Leaving them declared would let a future edit import them directly and quietly
re-fork the copies this migration exists to collapse. `amqplib` was never a dependency here — the
gateway is purely synchronous and touches no bus.

## D-GW-02 — `env.ts` validates required variables at import time

**Decision:** `REDIS_URL`, `JWT_SECRET`, `IDENTITY_SERVICE_URL`, `MEDIA_SERVICE_URL` and
`MATCH_SERVICE_URL` are read through a `required()` helper that throws on a missing value. `PORT`
keeps its `3000` default and `NODE_ENV` its `development` default.

**Why:** two reasons that happen to agree. Under `strict`, `process.env.X` is `string | undefined`
and `proxy(target)` needs a `string`, so the three service URLs must be narrowed somewhere
regardless. And it fixes issue 8 in `docs/architecture/01-api-gateway.md`: an unset
`MATCH_SERVICE_URL` previously produced `proxy(undefined)`, which fails obscurely on the first
request to that route rather than at boot.

**Deviation from behaviour-preservation, accepted:** a gateway started with a missing service URL
now refuses to boot instead of starting and 500-ing one of its three routes. Failing at startup is
the strictly more debuggable failure, and it is the same pattern the reference port established.

## D-GW-03 — The three proxies are built by one parameterised factory

**Decision:** `createServiceProxy(serviceName, target, logger, decorateHeaders)` in `proxies.ts`,
wrapped by `createIdentityProxy` / `createMediaProxy` / `createMatchProxy`.

**Why:** the original spread one shared `proxyOptions` object into all three `proxy()` calls and
then repeated `proxyReqOptDecorator` and `userResDecorator` verbatim, the latter differing only in
the service name it logged. Header injection is genuinely the only thing that varies between the
three, so it is the only thing the factory takes. The three wrappers stay separate rather than
collapsing into a config array because each carries a different piece of documentation — why
`/v1/auth` has no `validateToken`, why the media Content-Type check exists.

Taking `target` and `logger` as parameters rather than reading `env` inside `proxies.ts` mirrors
`createValidateToken(secret, logger)` in `@uff/shared/auth`: config first, logger last.

## D-GW-04 — Guarded the media proxy's Content-Type check (fixes a latent 500)

**Decision:** `srcReq.headers['content-type'].startsWith('multipart/form-data')` becomes
`srcReq.headers['content-type']?.startsWith('multipart/form-data') ?? false`.

**Why:** this is the one place the behaviour-preserving rule is broken on purpose. Under `strict`
the original does not compile — `headers['content-type']` is `string | undefined` — which forced
the question, and the answer is that the original is a live bug (issue 2). Any request without a
body carries no `Content-Type`, so **every `GET` and `DELETE` to `/v1/media/*` threw
`TypeError: Cannot read properties of undefined` inside `proxyReqOptDecorator`** before the request
ever reached media-service.

`?? false` makes a missing Content-Type take the same branch as a non-multipart one: the header is
set to `application/json` and the request proxies normally. The alternative — treating "absent" as
multipart — would forward bodyless requests without the JSON content type the other two proxies
always set, which is a larger behaviour change than the crash it replaces.

**Preserved:** the check still only guards the *overwrite*. A genuine `multipart/form-data` upload
keeps its own boundary-carrying header, which is what makes multer parse it downstream.

## D-GW-05 — `/health` is registered before the rate limiter

**Decision:** `GET /health` sits above `app.use(ratelimit)` in the middleware chain, not below it
with the proxy routes.

**Why:** the limiter is global and allows 100 requests per IP per 15 minutes. A container health
probe on a 10-second interval is 90 requests per 15 minutes by itself, and compose health checks
run *inside* the container, so every probe shares one loopback IP with anything else originating
there. Behind the limiter the probe would start returning `429`, the orchestrator would read that
as unhealthy, and it would restart a gateway that was working perfectly.

**What it reports:** Redis reachability only (`redisClient.status === 'ready'`), per the service
brief. The gateway owns no database and no message bus. Redis being down does not stop the gateway
proxying — it breaks rate limiting — so the endpoint returns `503`/`degraded` rather than pretending
the state is fine, and never blocks traffic.

**Trade accepted:** `/health` is now unauthenticated *and* unmetered, so it can be polled freely
from outside. It exposes one boolean and a connection-state string, which is not worth protecting.

## D-GW-06 — `app.set('trust proxy', 1)` left in its original position

**Decision:** still registered *after* `app.use(ratelimit)`, exactly where the original had it.

**Why:** issue 1 in the architecture doc — registering it late means `express-rate-limit` may key on
the load balancer's IP rather than the client's, putting every user in one bucket. It is a real bug
and the fix is a one-line move.

It is not moved because that is a **behaviour change to the rate limiter**, which is the one
subsystem here that is live and shared across replicas. Moving it changes who gets limited and when,
under load, with no test to catch a regression — exactly the kind of change the behaviour-preserving
rule exists to keep out of a language port. Recorded here so the fix is one commit away and its
consequence is already written down. Backlog item 7.

## D-GW-07 — Used `@types/express-http-proxy` rather than a local declaration

**Decision:** added `@types/express-http-proxy@^1.6.7` as a dev dependency. No
`src/types/express-http-proxy.d.ts` was written.

**Why:** the brief anticipated that no published types existed. They do — `npm view
@types/express-http-proxy version` returns `1.6.7` — so a hand-written module declaration would be
strictly worse: less accurate, and permanently ours to maintain.

**Version skew, checked rather than assumed:** the types are published for the 1.6 line while the
runtime dependency is `express-http-proxy@2.1.2`. Every option this service passes was read out of
the definitions and confirmed present and correctly shaped — `proxyReqPathResolver`,
`proxyErrorHandler`, `proxyReqOptDecorator`, `userResDecorator`. `proxyReqOptDecorator` types its
first argument as `Omit<RequestOptions,'headers'> & { headers: OutgoingHttpHeaders }`, which is what
lets `HeaderDecorator` in `proxies.ts` be typed against `OutgoingHttpHeaders` instead of `any`.

**Risk:** the types do not describe options added in 2.x. Nothing here uses one, but a future edit
reaching for a 2.x-only option will get a type error rather than a hint, and the fix at that point
is a module augmentation.

## D-GW-08 — Dockerfile copies all six workspace manifests

**Decision:** the multi-stage build copies `package.json` from *every* workspace, including the four
services it does not build. Mirrors D-ID-09.

**Why:** `npm ci` validates `package-lock.json` against every workspace declared in the root
`package.json`. Omitting the un-ported services makes the install fail even though they are not part
of this image. Only `packages/shared` and `api-gateway` are installed (`--workspace` flags) and only
their `dist/` reaches the runtime stage.

**Note:** `--include-workspace-root` is deliberately NOT passed — that would pull the legacy
monolith's Express 4 dependency tree into the image.

## D-GW-09 — Dropped the commented-out post-service and search-service proxies

**Decision:** the two commented `/v1/posts` and `/v1/search` blocks are deleted, not ported.

**Why:** dead code, not behaviour. Neither `POST_SERVICE_URL` nor `SEARCH_SERVICE_URL` is set
anywhere, and neither service exists in the repository. Both blocks are recoverable from git history
if those services are ever built, and by then the surrounding proxy code will have moved on anyway.

## D-GW-10 — Shutdown exits inside the `server.close` callback

**Decision:** `shutdown()` calls `process.exit(0)` from within the `server.close()` callback, rather
than after it as identity-service does.

**Why:** a deliberate small divergence from the reference. identity-service fires `server.close()`
and then `await`s RabbitMQ and Mongo, so in-flight requests get the duration of those closes to
finish. The gateway has nothing to await — no bus, no database — so copying that shape literally
would call `process.exit(0)` microseconds after `close()` and sever every in-flight proxied
response. The gateway is the public edge; it is the one service where that is visible to real users.

`shutdown` is also synchronous rather than `async`, because there is nothing to await. This is why
`server.close` is not wrapped in a promise and why the `void shutdown(...)` idiom from the reference
is absent.

**Known gap:** there is no forced-exit timer, so a hung upstream connection keeps the process alive
until the orchestrator's SIGKILL (10s under Docker's default).

## D-GW-11 — Stale `api-gateway/package-lock.json` left untouched

**Decision:** not updated and not deleted, despite now contradicting `package.json`.

**Why:** it is a pre-workspace artefact that npm ignores under workspaces — the root lockfile is
authoritative. It is also frozen at the baseline commit `2e21110` in **all five services**, including
identity-service, which the reference port left alone too. Deleting only this one would be an
inconsistent partial cleanup, and the migration rules explicitly reserve lockfile handling for
Phase 2, which regenerates the root lockfile once after all four branches merge.

**Reported for Phase 2:** all five per-service `package-lock.json` files should be deleted in one
sweep during integration.
