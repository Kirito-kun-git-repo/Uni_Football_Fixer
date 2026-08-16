# Decision Log

Every meaningful decision, in the order it was made, with the reasoning behind it.
Commits that implement a decision cite its ID in the commit message, so
`git log --grep=D-05` returns every line of code a decision produced.

Root decisions (`D-NN`) were frozen for the duration of Phase 1 — four agents in four
worktrees appending to one file would conflict on every merge after the first (D-09).
The freeze ended when the branches merged: D-11 onward are Phase 2 decisions, written by
a single owner against a single branch. Service-level decisions live in
`<service>/DECISIONS.md` with service-prefixed IDs.

| Service | Log | Prefix |
|---|---|---|
| api-gateway | `api-gateway/DECISIONS.md` | `D-GW-` |
| identity-service | `identity-service/DECISIONS.md` | `D-ID-` |
| match-service | `match-service/DECISIONS.md` | `D-MT-` |
| media-service | `media-service/DECISIONS.md` | `D-MD-` |
| notification-service | `notification-service/DECISIONS.md` | `D-NT-` |

---

## D-01 — Full TypeScript + ESM migration

**Decision:** Port all five services to TypeScript with ESM output, rather than bumping dependencies.

**Why:** Exploration showed the premise of the request was wrong. Runtime dependencies were already
near-latest (Express 5.1, Mongoose 8.17, dotenv 17, multer 2, joi 18, redis 5.8, helmet 8.1); a
dependency bump would have changed almost nothing. What was actually stale was the surrounding
stack — Node 18 EOL base images, no type safety, phantom dependencies, no containerization.

**Rejected:** deps-only bump (changes nothing); runtime/hygiene only (leaves the copy-paste and
untyped event payloads); ESM without TypeScript (churn without the payoff).

## D-02 — Legacy monolith `/src` kept as-is, excluded from migration

**Decision:** `/src` stays on Express 4 untouched and is not a workspace member.

**Why:** The microservices already cover auth, matches, and media. The monolith's only unique
features are Socket.io chat and admin routes, which are a separate porting project.

**Consequence:** the root `package.json` must keep the monolith's dependencies and must **not**
set `"type": "module"`, which would break its CommonJS `require` calls.

**Rejected:** delete it (loses unported features); port its features first (expands scope);
migrate it too (doubles work for possibly-dead code).

## D-03 — npm workspaces + `packages/shared` with runtime code and typed contracts

**Decision:** One shared package holding the RabbitMQ client, logger, error handler, auth
middleware, and typed event contracts.

**Why:** `rabbitmq.js` was byte-identical across four services and `logger.js`/`errorHandler.js`/
`authMiddleware.js` near-identical across five — every fix had to be made five times. Typed event
contracts additionally give compile-time checking across service boundaries, which is where the
documented payload-shape inconsistencies live.

**Consequence:** the shared package must land before service ports, creating a serial phase.

**Rejected:** five independent projects (keeps duplication, five disagreeing copies of each event
type); shared types only (leaves the RabbitMQ duplication in place).

## D-04 — Verify by docker-compose smoke test + `tsc --noEmit`

**Decision:** No unit test suites. Verification is type-check, stack boot, and one end-to-end
smoke test asserting the real business flow.

**Why:** `tsc` proves type consistency but cannot reach across the RabbitMQ boundary, which is
where a broken port would hide. A smoke test covering register → login → upload → create match →
invite → accept catches real breakage across all four hops, and produces a reproducibly runnable
stack, which the project does not currently have at all.

**Accepted cost:** a logic error inside a controller that still returns a well-shaped response
passes all three verification layers.

**Rejected:** full per-service suites (roughly doubles each agent's work); type-check only
(silently-wrong runtime behavior ships).

## D-05 — Fix the event bus; leave auth trust and dual-path enrichment alone

**Decision:** Make the exchange durable, use named durable queues, ack only after the handler
resolves, add a dead-letter exchange. Do not touch the `x-team-id` trust model or the duplicated
sync/async enrichment paths.

**Why:** The bus was losing messages silently — a non-durable exchange plus anonymous exclusive
queues means anything published while a consumer is down is gone forever, and two replicas of
`notification-service` would each send every email. That is data loss and a scaling ceiling, not
a style issue. Auth and dual-path enrichment are redesigns, not migrations.

**Accepted consequence:** durable queues change the failure mode rather than only improving it.
A down consumer now accumulates a backlog instead of losing messages. RabbitMQ disk usage becomes
something to monitor, and a permanently-dead consumer builds an unbounded queue. The DLX bounds
the poison-message case but not the dead-consumer case.

**Rejected:** behavior-preserving only (leaves known data loss in place); also fix auth (couples
five services in one change); fix everything (redesign of match-service).

## D-06 — Approach A: foundation-first, then parallel fan-out

**Decision:** Phase 0 builds the workspace, shared package, and `identity-service` as a reference
port. Phase 1 runs four agents in parallel. Phase 2 integrates.

**Why:** The event bus is the integration surface between all five services and is also the thing
being fixed, so its contracts must be defined once before anyone ports a handler against them.
Porting one service in Phase 0 proves the shared package against real code and gives the parallel
agents a worked example — the strongest available predictor of consistent output among agents that
cannot see each other's work.

**Rejected:** strangler / one at a time (discards parallelism, serializes ~4000 LOC);
parallel-first then consolidate (five disagreeing copies of every event type, reconciled later at
higher cost than defining them once).

## D-07 — Each Phase 1 agent works in an isolated git worktree

**Decision:** Four worktrees on four branches, all cut from the Phase 0 commit on `main`.

**Why:** Isolation at the commit-graph level rather than by trusting four agents to stay in their
lane. Disjoint paths plus a pre-populated root `workspaces` array plus no agent committing a
lockfile makes merge conflicts structurally near-impossible.

## D-08 — Services stay flat at the repository root

**Decision:** Not relocated under `services/`.

**Why:** Relocating produces a large rename immediately before four agents branch from that
commit, and invalidates every path reference in `docs/architecture/`. The tidiness is not worth
the churn at this moment in the sequence.

## D-09 — Per-service `DECISIONS.md` and `FLOW.md`

**Decision:** Each service owns its own decision log and flow document. The root log is frozen
before agents branch.

**Why:** Documentation value, and a structural one: four agents in four worktrees appending to a
single root log would conflict on every merge after the first. Per-service files make that
conflict impossible.

`FLOW.md` is deliberately narrower than `docs/architecture/`. Those documents describe the system
*between* services; `FLOW.md` describes one service *internally* — request enters `server.ts`,
through which middleware in what order, into which route, which controller, which model call,
which event published — and marks which paths the port changed. That is the layer where a broken
port hides, and nothing previously documented it.

## D-10 — Adopt current dependency majors during the port

**Decision:** The port moves to the latest majors rather than pinning the versions in use today:

| Package | Was | Now |
|---|---|---|
| `mongoose` | ^8.17.1 | ^9.9.2 |
| `ioredis` | ^5.7.0 | ^6.0.0 |
| `amqplib` | ^0.10.9 | ^2.0.1 |
| `typescript` | — | ^7.0.2 |
| `argon2` | ^0.44.0 | ^0.45.1 |
| `express` | ^5.1.0 | ^5.2.1 |

**Why:** modernization is the stated goal of the project, and doing it in one pass means the four
Phase 1 agents inherit a single consistent baseline rather than porting against versions that get
bumped underneath them a week later. `identity-service` is ported first against these versions, so
any incompatibility surfaces in Phase 0 rather than four times in parallel.

**Concern raised and overruled:** this moves two variables at once. The language changes and the
ODM's behaviour changes in the same commit, so a smoke-test failure in Phase 2 has two candidate
causes rather than one. The alternative — port on `mongoose@8x`/`ioredis@5`, then bump majors after
Phase 2 with the smoke test already in place as a regression net — was considered and rejected in
favour of a single migration. Recorded here so that if a Phase 2 failure is hard to localise, this
is the first decision to question.

**Notes discovered while resolving versions:**
- `amqplib` 2.x ships its own type definitions, so `@types/amqplib` must NOT be installed.
- `@types/amqplib` is still published at 0.10.8 and would conflict.
- Verified against amqplib 2.0.1's own `index.d.ts`: `connect()` returns `ChannelModel`,
  `prefetch`/`close`/`assertQueue` are promise-returning, and `nack(msg, allUpTo, requeue)` is
  unchanged. The D-05 client design needed no adjustment for the two-major jump.

---

# Phase 2 — integration

D-01 through D-10 were made before any code was written. What follows was made while
merging the five ports into one working stack, in the order the problems appeared.

## D-11 — Regenerating this lockfile requires clearing *every* `node_modules`, not just the root

**Decision:** the only supported way to regenerate the workspace lockfile is

```sh
rm -rf node_modules package-lock.json */node_modules packages/shared/node_modules
npm install
```

**Why:** the first regeneration (342fc25) removed only `node_modules` and `package-lock.json`
and left the per-service `*/node_modules` trees behind from the Phase 1 worktree installs
(D-07). npm read those as already-satisfied and skipped resolving that part of the tree, so
the lockfile it wrote was incomplete: `express@5.2.1` declares `router@^2.2.0`, and `router`
appeared in neither the lockfile nor `node_modules`. Every one of the five services died at
startup with `Cannot find module 'router'` — in Docker *and* locally, which is what ruled out
the container build as the cause. Fixed in 7fd2b02 (3950 insertions, 4995 deletions against a
lockfile that was supposedly already current — the size of that diff is the measure of how much
had been skipped).

**Consequence:** this is a property of npm workspaces plus the worktree strategy, not a
one-off. It will recur every time this lockfile is regenerated, for as long as stale
per-package `node_modules` can exist — which is any time someone has run `npm install` inside a
service directory. A partial clean produces a lockfile that installs cleanly, passes
`tsc`, and fails only at runtime on the first `import`. Treat any `Cannot find module '<a
dependency you never named>'` in this repo as a symptom of this and re-run the full clean
before debugging anything else.

**Rejected:** `npm install <missing package>` to paper over the symptom — it would have added
`router` and left every other skipped subtree still missing, converting one loud failure into
an unknown number of quiet ones.

## D-12 — Only `api-gateway` publishes a port; the datastores publish nothing

**Decision:** `mongo`, `redis` and `rabbitmq` publish no host ports at all. The four downstream
services publish none either. `api-gateway` publishes `3000:3000`, and RabbitMQ's management UI
is published on `127.0.0.1:15672` only. The plan's draft published 27017, 6379 and 5672.

**Why:** the immediate reason was a collision — the host's 27017 was already taken by an
unrelated container. The better reason is the one that made the change permanent: not
publishing them means nothing outside the `uff` bridge network can reach a datastore or a
downstream service. That is the missing precondition for the `x-team-id` trust model. Backlog
item 1 is that every downstream service trusts the `x-team-id` header unconditionally, so
anyone who can reach a service port can impersonate any team. Not publishing the ports does not
fix that bug, but it means the only way in is through the gateway, which sets the header from a
verified JWT. Publishing 3001/3003/3004/3005 for convenience would have made the auth bypass
reachable from the host.

**Consequence:** debugging by pointing `mongosh` or `redis-cli` at localhost no longer works;
use `docker compose exec`. The management UI is deliberately still reachable, bound to loopback,
because inspecting `football.dlq` after a failed smoke test is worth one exception.

**Note:** the collision class is real and recurring, not specific to Mongo — at the time of
writing 27017 is free but a host-local Redis holds 6379. Publishing datastore ports from a
project stack collides with whatever the developer already runs.

## D-13 — RabbitMQ gets a named volume (`rabbitmq-data`)

**Decision:** `rabbitmq-data:/var/lib/rabbitmq`. The plan's compose draft defined `mongo-data`
and nothing else; `redis-data` was added at the same time.

**Why:** D-05's entire fix is that the exchange and queues are durable. Durable means *written
to disk* — and with no volume, that disk is the container's writable layer. A `docker compose
down` would delete it, silently discarding every durable queue and every message backlog sitting
in one, and the stack would come back up with the queues recreated empty. The bug D-05 fixed is
messages published while a consumer is down being lost forever; without this volume that bug is
still there, just moved from "consumer restarts" to "stack restarts". The volume is what makes
D-05 true across restarts rather than only within a single `up`.

**Consequence:** `docker compose down -v` is now destructive in a way `down` is not. It is the
correct way to reset the smoke-test fixtures, and the wrong way to restart the stack.

## D-14 — Placeholder credentials in `.env`; whether required-at-boot is right is left open

**Decision:** `.env` ships placeholder values for the five third-party credentials so the stack
boots. No service code changed.

**Why:** `media-service/src/env.ts` passes `CLOUD_NAME`, `CLOUDINARY_API_KEY` and
`CLOUDINARY_API_SECRET` through `required()`, and `notification-service/src/env.ts` does the
same for `EMAIL_USER` and `EMAIL_APP_PASSWORD`. `required()` throws at import time, so both
services crash-loop without them. Since `api-gateway` depends on `media-service` being healthy,
the practical effect is that the whole stack cannot boot for testing without a Cloudinary
account and a Gmail app password — credentials for two external services that the smoke test
never actually calls, because it asserts database state rather than delivered mail or a real
upload.

**Open question, recorded not resolved:** should credentials for an external service be required
at boot, or only at the point of use? Booting degraded — `media-service` up and serving reads,
with uploads failing 503 until Cloudinary is configured — would let the rest of the system be
tested and would let a credential rotation take effect without a restart storm. But fail-fast
has real merit and is why the agents wrote it this way (D-MD-03): the original code read the
Cloudinary config at module load with no validation at all, so a typo in the API secret surfaced
as a 401 on the first upload, potentially hours after deploy. Deferring validation to the point
of use is exactly how that bug happened. A defensible middle — validate the *shape* at boot,
prove the *credentials* on first use, and report both on `/health` — is more design than Phase 2
should be doing. Recorded here rather than as a new backlog item so the design spec's items 1–11
keep their numbers.

**Known inconsistency:** the comments in `.env.example` and in `docker-compose.yml`
(`notification-service`) claim the stack boots without these values and that they only fail at
the point of use. That is not true of the code as written — `required()` throws at import. The
comments describe the behaviour this decision is asking about, not the behaviour that exists.

## D-15 — Compose was written from the services' `env.ts`, not from the plan

**Decision:** the environment variable names in `docker-compose.yml` are `CLOUD_NAME`,
`CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `EMAIL_USER`, `EMAIL_APP_PASSWORD`. The plan
assumed `CLOUDINARY_CLOUD_NAME` and `SMTP_USER`/`SMTP_PASS`.

**Why:** the Phase 1 agents preserved the names the original code used, which was the correct
call — renaming an env var is a deployment-breaking change disguised as tidying, and the port
was supposed to change the language, not the interface. So the plan's names were the wrong ones,
and the real names were read out of the five `env.ts` files when compose was written.

**Consequence:** small, and worth the line it costs. A variable that is set but under the wrong
name is indistinguishable from one that is unset — the service throws `Missing required
environment variable: CLOUD_NAME` while `CLOUDINARY_CLOUD_NAME` sits right there in the
environment. `.env.example` carries an inline note on the `CLOUD_NAME` line for exactly this
reason. The general rule: when the plan and the code disagree about a name, the code wins.

---

# Phase 2 — what was verified

Re-verified against the running stack while writing this section, not copied from the Phase 2
notes. Commands are the evidence; anyone can re-run them.

**The event bus works end to end.** `npm run smoke` → `19/19 checks passed`. That includes the
two assertions that cross the RabbitMQ boundary and are the only checks in the migration capable
of detecting a broken event handler (D-04): `teamName` populated on the match via the
`fetchTeamDetails` → `TeamDetails` round-trip, and the match reaching status `matched` after the
invite is accepted. Both poll rather than sleep. Everything goes through the gateway on `:3000`,
so the `/v1` → `/api` rewriting and JWT verification are proved by the same run.

**The D-05 topology is what it was supposed to be.** `rabbitmqctl list_queues name durable
messages` returns nine queues, every one `durable=true`, and **zero** `amq.gen-*` queues — the
anonymous exclusive queues that caused the message loss are gone, not merely fewer.
`rabbitmqctl list_exchanges` shows `football.events` as a durable `topic` and
`football.events.dlx` as a durable `fanout`. `football.dlq` exists and holds 0 messages: the
dead-letter path is wired but nothing has poisoned it.

**The whole workspace typechecks and builds under `strict`.** `npm run typecheck` (`tsc
--noEmit` per workspace) and `npm run build` both complete with no diagnostics across all five
services and `packages/shared`, with `strict: true` in `tsconfig.base.json`. `find <service>/src
-name '*.js'` returns nothing for all five services and the shared package — no file was left
behind or dual-maintained.

**D-02 still holds.** The legacy monolith's twelve dependencies all still resolve by CommonJS
`require` from the repo root after the lockfile regeneration, on the root's own `express@4.22.2`
while the services resolve `express@5.2.1` — which is the arrangement D-02 and D-10 were
counting on.

**Advisories: 16 → 1.** Measured today with the current advisory database:
`npm audit --package-lock-only` against the pre-migration lockfile (77702a3, the last commit
before the workspace existed) reports 16 findings — 1 low, 3 moderate, 12 high. The Phase 2
notes recorded 15; advisory counts drift as the database is updated, so the two numbers are the
same measurement taken at different times, and neither is wrong. Against the current lockfile,
`npm audit` reports one high-severity finding, and it is
`nodemailer@6.10.1` — the *monolith's* pinned dependency under D-02, not the services'.
`notification-service` is on `nodemailer@9.0.5` and is clean. The remaining advisory is
therefore bounded by exactly the code D-02 chose not to migrate, and closing it means either
porting the monolith or bumping a dependency of code that is not otherwise being touched.
