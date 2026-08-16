# TypeScript Migration & Modernization — Design

**Date:** 2026-08-16
**Status:** approved, ready for implementation planning
**Baseline:** commit `2e21110 — Shifted to Microservice Architecture`
**Input documents:** `docs/architecture/00-system-overview.md` and the five per-service documents

---

## 1. Problem statement

The stated goal was "upgrade dependencies and migrate to newer versions of the tech stack."
Exploration showed the premise needed correcting: **the runtime dependencies are already
near-latest.** All five services run Express 5.1, Mongoose 8.17, dotenv 17, multer 2, joi 18,
redis 5.8, and helmet 8.1. A conventional dependency bump would change almost nothing.

What is actually stale is everything surrounding the dependencies:

| Gap | Evidence |
|---|---|
| Node 18 base images (EOL April 2025) | all three existing Dockerfiles pin `node:18-alpine` |
| No `engines` field in any service | absent from all five `package.json` files |
| Phantom dependencies | `mongoose` imported but undeclared in `match-service` and `notification-service`; resolves only via npm hoisting, breaks under `npm ci` |
| Dead dependency | `amqp@0.2.7` (abandoned 2015) in `identity-service`, alongside the real `amqplib` |
| No type safety | CommonJS throughout, no TypeScript |
| Copy-paste duplication | `rabbitmq.js` is **byte-identical** across four services; `logger.js`, `errorHandler.js`, `authMiddleware.js` are near-identical across five |
| Committed log files | 10 `error.log` / `combined.log` files tracked in git |
| Incomplete containerization | `match-service` and `notification-service` have no Dockerfile; no `docker-compose.yml` anywhere |
| No tests, no CI | every service: `"test": "echo \"Error: no test specified\" && exit 1"` |
| Silent event loss | non-durable exchange + anonymous exclusive queues (see §5) |

The migration therefore targets the surrounding stack, not the dependency versions.

---

## 2. Scope

### In scope

- Full TypeScript port of all five microservices, ESM output, `strict: true`
- npm workspaces monorepo with a shared package (`@uff/shared`)
- Node 24 LTS baseline, declared and pinned consistently
- Event-bus durability fixes (§5)
- Dockerfiles for all five services, `docker-compose.yml`, end-to-end smoke test
- Health endpoints and graceful shutdown per service
- Removal of committed log files; correction of phantom and dead dependencies
- Per-service `DECISIONS.md` and `FLOW.md`

### Out of scope

- **The legacy monolith in `/src`** — remains on Express 4 exactly as it is, is not a workspace
  member, and is not migrated (decision D-02). It contains Socket.io chat and admin routes that no
  microservice implements; porting those features is separate future work.
- **Auth trust model.** Downstream services continue to trust the `x-team-id` header injected by
  the gateway. The auth-bypass hole documented in `00-system-overview.md` §4 is recorded in the
  backlog, not fixed here.
- **Dual-path enrichment.** Every enrichment step exists twice — once as synchronous HTTP, once as
  an event fallback — with mismatched payload shapes. The port preserves both paths and both
  shapes. Collapsing them is a redesign of `match-service`, not a migration.
- **Unit and integration test suites.** Verification is by type-check plus end-to-end smoke test
  (§7). Per-service test suites are deferred.

### Behavior-preservation rule

Outside the event-bus fixes in §5, the port changes **language, not semantics**. Where existing
code is inconsistent or wrong, the TypeScript version reproduces the same observable behavior and
records the defect in the backlog. This keeps one variable moving at a time: any behavioral diff
the smoke test detects is a porting bug, not an intentional change.

---

## 3. Decisions

Recorded in full, in order, in `docs/DECISIONS.md`. Summary:

| ID | Decision | Rejected alternatives |
|---|---|---|
| D-01 | Full TypeScript + ESM migration | deps-only bump; runtime/hygiene only; ESM without TS |
| D-02 | Legacy `/src` monolith kept as-is, excluded | delete it; port its features; migrate it too |
| D-03 | npm workspaces + `packages/shared` with runtime code *and* typed contracts | five independent projects; shared types only |
| D-04 | Verify by docker-compose smoke test + `tsc --noEmit` | full per-service test suites; type-check only |
| D-05 | Fix the event bus; leave auth trust and dual-path enrichment alone | behavior-preserving only; also fix auth; fix everything |
| D-06 | Approach A — foundation-first, then parallel fan-out | strangler (serial); parallel-first with later consolidation |
| D-07 | Each Phase 1 agent works in an isolated git worktree | shared working directory |
| D-08 | Services stay flat at repo root; not relocated under `services/` | `services/` subdirectory |
| D-09 | Per-service `DECISIONS.md` + `FLOW.md`; root log frozen before agents branch | single shared decision log |

D-09 exists for a structural reason as much as a documentation one: four agents appending to one
root log would conflict on every merge after the first. Per-service files make that conflict
impossible.

---

## 4. Target stack and layout

**Runtime.** Node 24 (Active LTS). Pinned identically in every Dockerfile as `node:24-alpine` and
declared as `"engines": { "node": ">=24" }` in every `package.json`.

**Modules.** ESM. `"type": "module"`, TypeScript `module: "nodenext"`, `moduleResolution: "nodenext"`.

> **Convention all agents must follow identically:** under NodeNext ESM, relative imports carry
> explicit `.js` extensions even though the source file is `.ts` —
> `import { logger } from './utils/logger.js'`. This is the most likely source of divergence when
> several agents convert code independently, so it is stated in the shared conventions each agent
> receives.

**Tooling.** `tsc` for build — no bundler; these are five services of 222–961 LOC each and a
bundler would add configuration surface for no benefit. `tsx watch` replaces `nodemon` for dev.
`tsc --noEmit` is the type-check gate. A root `tsconfig.base.json` carries `strict: true` and
shared compiler options; each service extends it and sets its own `outDir`/`rootDir`.

**Exact dependency versions** are resolved with `npm view` at implementation time rather than
written into this spec. Pinning versions from memory is the precise failure mode this migration
exists to correct.

**Layout:**

```
package.json                  private workspace root
tsconfig.base.json
docker-compose.yml            Phase 2
docs/
  DECISIONS.md                root decision log, frozen after Phase 0
  architecture/               existing as-built documents
  superpowers/specs/          this document
packages/
  shared/                     Phase 0
api-gateway/                  Phase 1, worktree
identity-service/             Phase 0, reference implementation
match-service/                Phase 1, worktree
media-service/                Phase 1, worktree
notification-service/         Phase 1, worktree
src/                          legacy monolith — untouched, NOT a workspace member
```

Flat layout keeps the Phase 0 diff small and reviewable. Relocating all five services under
`services/` would produce a large rename immediately before four agents branch from that commit,
and would invalidate every path reference in the existing architecture documents.

---

## 5. `packages/shared` and the event contracts

Package name `@uff/shared`. TypeScript, built with `tsc` to `dist/`, consumed through the npm
workspace protocol — never published.

### Export surfaces

| Export | Replaces | Notes |
|---|---|---|
| `@uff/shared/events` | nothing — new | Typed contracts for all 8 routing keys |
| `@uff/shared/rabbitmq` | 4 byte-identical copies | Rewritten with the durability fixes below |
| `@uff/shared/logger` | 5 near-identical copies | Console transport only; file transports removed |
| `@uff/shared/errors` | 5 copies of `errorHandler` | Express 5 error middleware, typed |
| `@uff/shared/auth` | 5 copies of `authMiddleware` | Includes `Express.Request` augmentation for `req.team` |

### Event contracts

A discriminated union keyed by routing key, covering all eight keys currently in use:

```
profilePhoto.updated                        media        → identity
fetchTeamDetails                            match        → identity
TeamDetails                                 identity     → match
fetchTeamDetailsForMatchInviteCreated       match        → identity
TeamDetailsForMatchInvite                   identity     → match
fetchTeamDetailsForRespondingToInvite       match        → identity
teamDetailsForRespondingToInvite            identity     → match
notification                                match        → notification
```

Typing these makes `publishEvent(key, payload)` reject a mismatched payload at compile time —
directly addressing the "payload shapes are implicit and already inconsistent" defect.

**Constraint:** each contract is defined to match **what the code sends today**, including the
places where the synchronous and asynchronous branches of the same flow disagree. Those
divergences are encoded and marked `// D-05: divergence preserved, see backlog item 2`. Unifying
them is the out-of-scope dual-path fix.

The inconsistent naming across routing keys (`PascalCase`, `camelCase`, `dot.case`) is likewise
preserved. Renaming keys would require coordinated publisher and consumer changes across service
boundaries and would break any in-flight message during deploy.

### Event-bus fixes (D-05)

Current implementation, identical in four services:

```js
await channel.assertExchange(EXCHANGE_NAME, 'topic', { durable: false });
const q = await channel.assertQueue("", { exclusive: true });
channel.consume(q.queue, (msg) => {
    const content = JSON.parse(msg.content.toString());
    callback(content);          // not awaited
    channel.ack(msg);           // acks before the handler resolves
});
```

Target implementation:

1. `assertExchange('football.events', 'topic', { durable: true })`
2. Publishes marked `{ persistent: true }`
3. **Named durable queues per consumer** — e.g. `identity.fetchTeamDetails` — replacing anonymous
   `{ exclusive: true }` queues. One change, two defects fixed: events survive a consumer being
   down, and two replicas of `notification-service` share a queue instead of each sending every
   email. The service is horizontally scalable afterward; it is not today.
4. `await callback(content)` **before** `channel.ack(msg)`. A throwing handler `nack`s without
   requeue → dead-letter exchange `football.events.dlx` → queue `football.dlq`.
5. `channel.prefetch(10)` so a restarted consumer does not inhale an entire backlog at once.
6. Channel and connection closed on `SIGTERM`.

**Operational consequence, accepted deliberately.** Durable queues change the failure mode rather
than merely improving it. Today a down consumer loses messages silently; afterward it accumulates
a backlog that must drain. That is strictly better, but RabbitMQ disk usage becomes something to
monitor, and a permanently-dead consumer builds an unbounded queue. Recorded in `DECISIONS.md`
under D-05 so it is a known trade rather than a later surprise.

### Also in Phase 0

Cross-cutting corrections that must not be left to individual agents:

- `git rm` the 10 committed `error.log` / `combined.log` files; add to `.gitignore`
- Declare `mongoose` in `match-service` and `notification-service`
- Remove dead `amqp@0.2.7` from `identity-service`
- Pre-populate the root `workspaces` array with all five service names **before** agents branch,
  so no agent needs to touch the root `package.json`

---

## 6. Execution model

### Phasing (approach A, D-06)

**Phase 0 — foundation (sequential, hard gate).**
Workspace root, `tsconfig.base.json`, `packages/shared`, the cross-cutting fixes above, root
`docs/DECISIONS.md`, and **`identity-service` ported as the reference implementation**. Porting one
service here proves the shared package works against real code before four agents build on it, and
gives those agents a worked example — the single strongest predictor of consistent output among
agents that cannot see each other's work.

**Phase 0 must be committed to `main` before any worktree is branched.** Worktrees branch from a
commit; if `packages/shared` is not in that commit, every agent starts from a repo with a missing
dependency. This is a hard gate, not a preference.

**Phase 1 — parallel fan-out (four agents, four worktrees).**

```
git worktree add ../uff-api-gateway          migrate/api-gateway
git worktree add ../uff-match-service        migrate/match-service
git worktree add ../uff-media-service        migrate/media-service
git worktree add ../uff-notification-service migrate/notification-service
```

Each worktree gets its own `node_modules` and runs fully isolated.

**Phase 2 — integration (sequential).** Merge the four branches, regenerate the lockfile once, add
the two missing Dockerfiles, `docker-compose.yml`, and the end-to-end smoke test.

### Agent ownership rules

Given to every Phase 1 agent verbatim. These are what keep four blind parallel workstreams from
colliding.

- **May modify:** only its own service directory.
- **Must not modify:** `packages/shared`, `docs/DECISIONS.md`, root `package.json`,
  `tsconfig.base.json`, any other service, or `/src`.
- **Needs a change in `packages/shared`?** Stop and report it. Do not patch it locally. Four
  worktrees silently editing the same shared file is the one failure mode that poisons every
  branch at once, and it stays invisible until merge.
- **Must not commit `package-lock.json`.** The root lockfile is regenerated once after all four
  merges. Four agents each regenerating a 191KB lockfile guarantees four conflicting versions.

### Definition of done, per agent

1. Service fully ported to TypeScript ESM, consuming `@uff/shared`
2. `tsc --noEmit` clean under `strict: true`
3. Service boots and connects to its dependencies
4. Health endpoint and `SIGTERM` graceful shutdown present
5. `<service>/DECISIONS.md` written, IDs prefixed per service (`D-GW-01`, `D-MT-01`, `D-MD-01`,
   `D-NT-01`) so numbering never collides across worktrees
6. `<service>/FLOW.md` written
7. Non-obvious logic commented in the flow-explaining style — what the block is for, what calls
   into it, what assumes it exists — not restating what the code already says

### Documentation ownership

| File | Owner | Contents |
|---|---|---|
| `docs/DECISIONS.md` | Phase 0 | D-01…D-09 and cross-cutting calls; index linking to each service log. Frozen before agents branch. |
| `<service>/DECISIONS.md` | that service's agent | Judgment calls made during its port, service-prefixed IDs |
| `<service>/FLOW.md` | that service's agent | Internal execution paths at file:function granularity |

`FLOW.md` is deliberately narrower than `docs/architecture/`. Those documents describe the system
*between* services. `FLOW.md` describes one service *internally*: request enters `server.ts`,
passes through which middleware in what order, into which route, which controller function, which
model call, which event published — and marks which of those paths the port changed. That is the
layer where a broken port hides, and nothing currently documents it.

**Traceability mechanism.** Every decision carries an ID, and commits implementing a decision cite
that ID in the message. When something breaks later, `git log --grep=D-07` returns every line of
code that decision produced. This is the whole point of the decision log: code shows what changed,
`DECISIONS.md` shows why.

### Merge-back

Four branches merge sequentially into `main`. Conflicts should be structurally near-zero: the
modified paths are disjoint, the root `workspaces` array was pre-populated in Phase 0, and no agent
commits a lockfile. Isolation is bought at the commit-graph level rather than by trusting agents to
stay in their lane. After all four merges, one `npm install` regenerates the lockfile.

### Workload distribution

| Service | Files | LOC | Notes |
|---|---|---|---|
| `api-gateway` | 4 | 222 | smallest; proxy + JWT verification only |
| `notification-service` | 9 | 616 | no HTTP API; consumer, mailer, templates |
| `media-service` | 10 | 447 | Cloudinary upload, multer 2 |
| `match-service` | 12 | 961 | **largest**; two controllers, all dual-path enrichment |
| *(identity-service)* | *12* | *807* | *Phase 0 reference — not a Phase 1 agent* |

`match-service` is roughly 4× `api-gateway` and carries the most intricate logic. It runs longest
and is the likeliest to need a mid-flight checkpoint.

---

## 7. Verification (D-04)

**Layer 1 — type-check.** `tsc --noEmit` under `strict: true`, per service and across the
workspace. Proves internal type consistency and, via the shared event contracts, that publishers
and consumers agree on payload shapes across service boundaries.

**Layer 2 — the stack boots.** `docker-compose up` brings up all five services plus MongoDB, Redis,
and RabbitMQ. Every service exposes a health endpoint that compose health-checks. This capability
does not exist today at all — there is currently no way to run the full stack reproducibly.

**Layer 3 — end-to-end smoke test.** A script exercising the real business flow against the running
compose stack:

1. register a team → 2. login, capture access + refresh tokens → 3. upload a logo via
`media-service` → 4. assert `profilePhoto.updated` reached `identity-service` → 5. create a match →
6. assert the denormalized `teamName`/`collegeName` get populated by the async `fetchTeamDetails` /
`TeamDetails` round-trip → 7. register a second team and send an invite → 8. accept the invite →
9. assert the match becomes `matched`, other invites become `rejected`, and notification records
were written.

Steps 4, 6, and 9 are the important ones: they cross the RabbitMQ boundary and are the only
verification that the event handlers still work after the port. Type-checking cannot reach them.

**What this does not cover, stated plainly:** no unit tests, no branch coverage, no error-path
testing. A logic error inside a controller that still returns a well-shaped response passes all
three layers. This is the accepted cost of D-04.

---

## 8. Deferred backlog

Recorded during the migration, not fixed by it. Ranked by severity.

1. **Auth bypass** — downstream services trust `x-team-id` unconditionally; anyone who can reach a
   service port can impersonate any team. Needs a shared secret, signed header, or mTLS.
2. **Dual-path enrichment** — every enrichment exists as both sync HTTP and async event with
   different payload shapes; the main source of per-service bugs in the architecture docs.
3. **No service discovery** — gateway targets come from env vars; `match-service` hardcodes
   `http://localhost:3000` for its callbacks.
4. **`Team.role`** (`TEAM | ADMIN`) is never placed in the JWT and never checked anywhere.
5. **JWT `name` claim is always `undefined`** — the `Team` model field is `teamName`.
6. **Wide-open CORS** — `app.use(cors())` in every service.
7. **Rate limiting configured but disabled** in three of five services; ~100 lines of commented-out
   config per `server.js`.
8. **No tracing or correlation-ID propagation** — a `correlationId` is set on one event payload and
   never read. Flows spanning four hops are undebuggable.
9. **No central log store or rotation** after file transports are removed.
10. **Per-service unit and integration test suites.**
11. **No CI pipeline.**

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| A defect in `packages/shared` propagates to all five services | Phase 0 ports `identity-service` against the shared package before any agent branches; the reference port is the shared package's first real test |
| Four agents diverge on ESM/TS conventions | Explicit shared conventions document plus a completed reference implementation to imitate |
| An agent edits `packages/shared` in its worktree | Stated prohibition plus report-back protocol; caught at merge if violated |
| Behavior drift invisible to `tsc` | Smoke-test steps 4, 6, and 9 assert across the RabbitMQ boundary |
| `match-service` port too large for one clean pass | Identified in advance as the longest-running agent; checkpoint planned |
| Durable queues build an unbounded backlog behind a dead consumer | Accepted and documented under D-05; DLX bounds the poison-message case |
| Lockfile conflicts across four branches | No agent commits a lockfile; regenerated once after merge |

---

## 10. Next step

Implementation plan via the writing-plans skill, decomposed as: Phase 0 (sequential), Phase 1
(four parallel worktree agents), Phase 2 (sequential integration).
