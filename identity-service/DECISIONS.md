# identity-service — Decision Log

Service-level decisions from the TypeScript port. Root decisions live in `docs/DECISIONS.md`.
Commits cite these IDs, so `git log --grep=D-ID-06` returns the code a decision produced.

## D-ID-01 — Dropped `amqp@0.2.7`

**Decision:** removed from `package.json`.

**Why:** abandoned in 2015, never imported anywhere in the service. The real AMQP client is
`amqplib`, which now lives in `@uff/shared`. It was pure dependency noise that `npm audit` and
every future reader would have had to reason about.

## D-ID-02 — Dropped the rate-limiting dependencies

**Decision:** removed `express-rate-limit`, `rate-limit-redis`, `rate-limiter-flexible`, and `redis`.

**Why:** every rate limiter in `server.js` was commented out — roughly 100 lines of dead
configuration. The one `RateLimiterRedis` instance that was actually constructed was never applied
to any route, so removing it changes no observable behaviour. `redis` was installed alongside
`ioredis`; only `ioredis` was ever used.

**Risk:** re-enabling rate limiting later means re-adding a dependency. Backlog item 7.

## D-ID-03 — Renamed `identitty-controller.js` → `identity-controller.ts`

**Decision:** fixed the typo; also renamed `routes/identity-service.js` → `routes/identity-routes.ts`.

**Why:** both are internal imports with no external consumers, so the rename is behaviour-neutral.
The old route filename was confusingly identical to the service name.

## D-ID-04 — Deleted the unused `authMiddleware.js`

**Decision:** removed rather than ported.

**Why:** copy-pasted from the service template and never mounted in `server.js`. identity-service is
reached through the gateway *without* a JWT check — it is where tokens are issued — so it has no
authentication middleware by design. Porting it would have implied a protection that does not exist.

## D-ID-05 — Controllers and handlers built by factory functions

**Decision:** `createIdentityController(logger)` / `createEventHandlers(logger)` instead of
module-level singletons.

**Why:** `@uff/shared/logger` exports `createLogger(serviceName)` rather than a pre-built instance,
because the service name has to be bound somewhere. Factories are the smallest change that lets the
logger be injected once in `server.ts` and threaded down.

## D-ID-06 — Fixed a latent `ReferenceError` in `getTeamById`

**Decision:** the catch block logged `${id}`, an undefined variable, which threw inside the error
path. Changed to `${teamId}`.

**Why:** this is the one place the behaviour-preserving rule was broken deliberately. The original
"behaviour" was a crash in the error handler that masked whatever the real error had been — a
`ReferenceError` replacing a genuine diagnostic. Recorded here so the deviation is traceable.

## D-ID-07 — Mongoose 9 pre-save hooks have no `next` callback

**Decision:** `Team.ts`'s password-hashing hook rewritten from
`pre('save', async function (next) { ... next(); })` to `pre('save', async function () { ... })`.

**Why:** Mongoose 9 changed `PreSaveMiddlewareFunction` from `(this, next, opts?)` to
`(this, opts: SaveOptions) => void | Promise<void>`. Resolving continues the save; throwing aborts
it — exactly what `next(err)` did. Behaviour is unchanged; only the signalling mechanism moved.

**Applies to:** every service with a Mongoose hook. Surfaced here first because this is the
reference port, which is precisely why the reference port exists (D-06).

## D-ID-08 — ioredis 6 must be imported by name

**Decision:** `import { Redis } from 'ioredis'`, not `import Redis from 'ioredis'`.

**Why:** under `module: nodenext`, ioredis 6's default export does not resolve to a constructable
type, so `new Redis(url)` fails to compile with "This expression is not constructable". The named
export works under both module systems.

**Applies to:** every service that touches Redis — which is all of them except match-service.

## D-ID-09 — Dockerfile copies all six workspace manifests

**Decision:** the multi-stage build copies `package.json` from *every* workspace, including the four
services it does not build.

**Why:** `npm ci` validates `package-lock.json` against every workspace declared in the root
`package.json`. Omitting the un-ported services makes the install fail even though they are not part
of this image. Only `packages/shared` and `identity-service` are actually installed
(`--workspace` flags) and only their `dist/` output is copied into the runtime stage, so the image
stays small.

**Note:** `--include-workspace-root` is deliberately NOT passed — that would pull the legacy
monolith's Express 4 dependency tree into the image.
