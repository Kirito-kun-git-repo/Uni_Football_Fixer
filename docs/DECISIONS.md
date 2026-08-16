# Decision Log

Every meaningful decision, in the order it was made, with the reasoning behind it.
Commits that implement a decision cite its ID in the commit message, so
`git log --grep=D-05` returns every line of code a decision produced.

Root decisions (`D-NN`) are frozen after Phase 0. Service-level decisions live in
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
