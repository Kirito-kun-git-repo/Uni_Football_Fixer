# TypeScript Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate all five microservices to TypeScript + ESM on Node 24 LTS, behind a shared workspace package that holds typed event contracts and a durable RabbitMQ client.

**Architecture:** npm workspaces monorepo. `packages/shared` is built first and holds the RabbitMQ client, logger, error handler, auth middleware, and typed contracts for all eight routing keys. `identity-service` is ported in the same sequential phase as the reference implementation, proving the shared package against real code. The remaining four services are then ported by parallel agents, each in an isolated git worktree, each touching only its own directory. Verification is by type-check plus an end-to-end smoke test against a docker-compose stack.

**Tech Stack:** TypeScript (NodeNext ESM, `strict`), Node 24 LTS, Express 5, Mongoose 8, amqplib, ioredis, winston, argon2, joi, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-08-16-typescript-migration-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **Node baseline:** Node 24 LTS. `"engines": { "node": ">=24" }` in every workspace `package.json`; every Dockerfile pins `node:24-alpine`.
- **Module system:** ESM. Each *service and package* sets `"type": "module"`. TypeScript `module: "nodenext"`, `moduleResolution: "nodenext"`.
- **The root `package.json` MUST NOT set `"type": "module"`.** The legacy monolith in `/src` is CommonJS and relies on the root package defaulting to CommonJS. Setting it at root silently breaks the monolith. (D-02)
- **Relative imports carry explicit `.js` extensions** even though sources are `.ts`: `import { x } from './utils/logger.js'`. This is mandatory under NodeNext ESM and is the most likely divergence point across parallel agents.
- **`strict: true`** everywhere. No `any` without an adjacent comment explaining why.
- **Behavior-preserving.** Outside the §5 event-bus fixes, the port changes language, not semantics. Reproduce existing behavior including its inconsistencies; record defects in the backlog rather than fixing them.
- **No unit tests in this plan.** The spec chose type-check + smoke test (D-04). This intentionally deviates from the writing-plans skill's TDD default. Verification steps are `tsc --noEmit`, boot checks, and the Phase 2 smoke test.
- **Decision IDs:** root decisions are `D-NN`. Service-level decisions are prefixed per service: `D-GW-NN` (api-gateway), `D-MT-NN` (match), `D-MD-NN` (media), `D-NT-NN` (notification), `D-ID-NN` (identity). Commits implementing a decision cite its ID.
- **Do not touch `/src`.** It is not a workspace member and is out of scope.
- **Exact dependency versions** are resolved with `npm view <pkg> version` at implementation time, never written from memory.

---

## File Structure

| Path | Responsibility |
|---|---|
| `package.json` | Workspace root; also retains the legacy monolith's own deps and scripts |
| `tsconfig.base.json` | Shared compiler options; every workspace extends it |
| `docs/DECISIONS.md` | Root decision log D-01…D-09, frozen after Phase 0 |
| `packages/shared/src/logger.ts` | `createLogger(serviceName)` — console transport only |
| `packages/shared/src/events.ts` | `EventMap`, `RoutingKey`, all payload interfaces |
| `packages/shared/src/rabbitmq.ts` | Durable connect/publish/consume + DLX + graceful close |
| `packages/shared/src/errors.ts` | Typed Express 5 error middleware |
| `packages/shared/src/auth.ts` | `validateToken` (gateway) + `authenticateRequest` (downstream) + Request augmentation |
| `<service>/src/env.ts` | Validated environment access; removes `process.env.X!` from the codebase |
| `<service>/src/server.ts` | Composition root: middleware, routes, consumers, health, shutdown |
| `<service>/DECISIONS.md` | That service's port decisions |
| `<service>/FLOW.md` | That service's internal execution paths |
| `docker-compose.yml` | Full stack: 5 services + MongoDB + Redis + RabbitMQ |
| `scripts/smoke-test.mjs` | End-to-end business-flow assertion |

---

# PHASE 0 — Foundation (sequential, hard gate)

Phase 0 must be **committed and merged to `main`** before any worktree is created. Worktrees branch from a commit; if `packages/shared` is absent from that commit, every agent starts from a broken repo.

---

### Task 1: Workspace root, base tsconfig, and repo hygiene

**Files:**
- Modify: `package.json`
- Create: `tsconfig.base.json`
- Modify: `.gitignore`
- Create: `docs/DECISIONS.md`
- Delete: 10 tracked log files

**Interfaces:**
- Consumes: nothing
- Produces: the `workspaces` array all later tasks rely on; `tsconfig.base.json` which every workspace `tsconfig.json` extends

- [ ] **Step 0: Create the Phase 0 branch**

All of Phase 0 (Tasks 1–9) happens on one branch, merged to `main` at the end of Task 9. The four Phase 1 worktrees branch from that merge commit.

```bash
git checkout main
git checkout -b migrate/foundation
```

- [ ] **Step 1: Confirm the tracked log files before deleting**

```bash
git ls-files | grep '\.log$'
```
Expected: exactly 10 paths — `error.log` and `combined.log` under each of the five services.

- [ ] **Step 2: Remove them from tracking and ignore them**

```bash
git rm --cached $(git ls-files | grep '\.log$')
rm -f */error.log */combined.log
```

Append to `.gitignore`:

```gitignore
# build output
dist/
*.tsbuildinfo

# logs (D-03: winston file transports removed in favour of stdout)
*.log
```

- [ ] **Step 3: Convert the root package.json to a workspace root**

Keep every existing dependency and script — the legacy monolith in `/src` runs from this package and must keep working (D-02). Add only `private`, `workspaces`, and `engines`; **do not add `"type": "module"`**.

```json
{
  "name": "football_fixer",
  "version": "1.0.0",
  "description": "A football match scheduling application",
  "private": true,
  "main": "src/index.js",
  "workspaces": [
    "packages/shared",
    "api-gateway",
    "identity-service",
    "match-service",
    "media-service",
    "notification-service"
  ],
  "scripts": {
    "start": "node src/index.js",
    "dev": "nodemon src/index.js",
    "test": "jest",
    "build": "npm run build --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present"
  },
  "author": "",
  "license": "ISC",
  "dependencies": {
    "bcryptjs": "^2.4.3",
    "body-parser": "^1.20.3",
    "cors": "2.8.5",
    "dotenv": "16.3.1",
    "express": "^4.21.2",
    "jsonwebtoken": "^9.0.2",
    "mongoose": "^8.13.2",
    "multer": "^1.4.5-lts.2",
    "nodemailer": "^6.10.0",
    "passport": "0.6.0",
    "passport-jwt": "4.0.1",
    "socket.io": "^4.8.1"
  },
  "devDependencies": {
    "@eslint/js": "^9.30.1",
    "jest": "29.7.0",
    "nodemon": "^3.1.10"
  },
  "engines": {
    "node": ">=24"
  }
}
```

The `workspaces` array lists **all five services up front**, even though four do not yet have a TypeScript `package.json`. This is deliberate: it means no Phase 1 agent ever needs to modify the root file, which is what keeps the four branches conflict-free at merge.

- [ ] **Step 4: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "es2023",
    "lib": ["ES2023"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noImplicitOverride": true,
    "noUnusedLocals": false,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

`noUnusedLocals` is off deliberately — the ported code carries commented-out blocks and unused imports, and turning this on would force cleanup that violates the behavior-preserving rule.

- [ ] **Step 5: Create `docs/DECISIONS.md`**

```markdown
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
```

- [ ] **Step 6: Verify the workspace resolves**

```bash
npm install
npm ls --workspaces --depth=0
```
Expected: install succeeds. `packages/shared` does not exist yet, so npm may warn about the missing workspace — that is expected and resolved in Task 2.

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.base.json .gitignore docs/DECISIONS.md package-lock.json
git commit -m "chore: establish npm workspace root and decision log (D-01..D-09)

Removes 10 tracked log files, adds workspace and engines declarations,
and pre-populates the workspaces array with all five services so no
Phase 1 agent needs to touch the root package.json."
```

---

### Task 2: `@uff/shared` scaffold and logger

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/logger.ts`

**Interfaces:**
- Consumes: `tsconfig.base.json` (Task 1)
- Produces: `createLogger(serviceName: string): Logger`, exported from `@uff/shared/logger`. Every other shared module and every service takes its logger from here.

- [ ] **Step 1: Resolve current dependency versions**

```bash
npm view winston version
npm view amqplib version
npm view jsonwebtoken version
npm view express version
npm view typescript version
npm view @types/node version
npm view @types/amqplib version
npm view @types/express version
npm view @types/jsonwebtoken version
```
Use the reported versions as `^<version>` below. Do not copy versions from memory.

- [ ] **Step 2: Create `packages/shared/package.json`**

```json
{
  "name": "@uff/shared",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./logger": "./dist/logger.js",
    "./events": "./dist/events.js",
    "./rabbitmq": "./dist/rabbitmq.js",
    "./errors": "./dist/errors.js",
    "./auth": "./dist/auth.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "amqplib": "^<resolved>",
    "express": "^<resolved>",
    "jsonwebtoken": "^<resolved>",
    "winston": "^<resolved>"
  },
  "devDependencies": {
    "@types/amqplib": "^<resolved>",
    "@types/express": "^<resolved>",
    "@types/jsonwebtoken": "^<resolved>",
    "@types/node": "^<resolved>",
    "typescript": "^<resolved>"
  },
  "engines": { "node": ">=24" }
}
```

The `exports` map points at `dist/`, so **`@uff/shared` must be built before any service can type-check against it.** Every service's `typecheck` script therefore depends on `npm run build -w @uff/shared` having run.

- [ ] **Step 3: Create `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 4: Create `packages/shared/src/logger.ts`**

Replaces five near-identical `logger.js` files. The only difference between them was the
`defaultMeta.service` string, which becomes the function parameter. **File transports are
dropped** (D-03) — they wrote `error.log`/`combined.log` into each service directory with no
rotation, and those files ended up committed to git. Container stdout is the correct sink.

```ts
import winston from 'winston';

export type Logger = winston.Logger;

/**
 * Builds the logger every service uses. Called once per service, at the top of
 * `server.ts`, and the returned instance is threaded to controllers and handlers.
 *
 * Console-only by design: in a container, stdout is the log transport. The previous
 * per-service file transports are removed (D-03).
 */
export function createLogger(serviceName: string): Logger {
  return winston.createLogger({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.splat(),
      winston.format.json(),
    ),
    defaultMeta: { service: serviceName },
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple(),
        ),
      }),
    ],
  });
}
```

- [ ] **Step 5: Install and build**

```bash
npm install
npm run build -w @uff/shared
```
Expected: `packages/shared/dist/logger.js` and `logger.d.ts` exist.

- [ ] **Step 6: Commit**

```bash
git add packages/shared package.json package-lock.json
git commit -m "feat(shared): scaffold @uff/shared with console-only logger (D-03)"
```

---

### Task 3: Typed event contracts

**Files:**
- Create: `packages/shared/src/events.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `EventMap`, `RoutingKey`, `TeamSummary`, `EnrichedTeam`, `TeamDocumentPayload`, `NotificationEvent`. `rabbitmq.ts` (Task 4) constrains `publishEvent`/`consumeEvent` against `EventMap`, and every service's handlers type their parameters from it.

**Context for the implementer:** these eight routing keys are the complete set in use. Each payload below was read off the actual publisher call site, not inferred. Where the synchronous and asynchronous branches of a flow publish *different shapes under the same key*, both shapes are encoded and marked — the behavior-preserving rule forbids unifying them here (D-05).

- [ ] **Step 1: Create `packages/shared/src/events.ts`**

```ts
/**
 * Typed contracts for every routing key on the `football.events` exchange.
 *
 * These types are the integration surface between all five services: the publisher
 * and the consumer of each key both import from here, so a shape change that breaks
 * a consumer fails at compile time instead of silently at runtime.
 *
 * IMPORTANT: these describe what the code sends TODAY, including its inconsistencies.
 * See the `D-05` notes below — those divergences are preserved deliberately and are
 * tracked as backlog item 2 (dual-path enrichment).
 */

export const EXCHANGE_NAME = 'football.events';
export const DLX_NAME = 'football.events.dlx';
export const DLQ_NAME = 'football.dlq';

/** Partial team info assembled by match-service's synchronous enrichment path. */
export interface TeamSummary {
  teamId: string;
  teamName?: string | undefined;
  email?: string | undefined;
  collegeName?: string | undefined;
}

/** Team info produced by identity-service's batch enrichment handler. */
export interface EnrichedTeam {
  teamId: string;
  role?: string;
  email?: string;
  collegeName?: string;
  teamName?: string;
  /** Set instead of the other fields when the lookup failed. */
  error?: string;
}

/**
 * A full Mongoose Team document after `.toObject()`.
 *
 * D-05: this includes `password` — the argon2 hash is published onto the bus by
 * identity-service's `handleTeamDetailEvent`. Preserved to keep the port
 * behavior-preserving; recorded as backlog item 12.
 */
export interface TeamDocumentPayload {
  _id: string;
  teamName: string;
  collegeName: string;
  email: string;
  password: string;
  logoUrl?: string;
  role: 'TEAM' | 'ADMIN';
  createdAt: string;
  updatedAt: string;
  __v?: number;
}

/**
 * D-05: published by `createInvite`'s synchronous path WITHOUT a `purpose` field —
 * the `purpose: 'invite'` line is commented out at the call site. notification-service
 * switches on `event.purpose`, so this shape falls through to `default` and no email
 * is sent. The asynchronous fallback path adds `purpose: 'invite'` before publishing.
 * Both shapes are preserved; see backlog item 2.
 */
export interface InviteNotification {
  purpose?: 'invite';
  inviteId: string;
  matchId: string;
  sender: TeamSummary;
  receiver: TeamSummary;
  status: string;
  note: string | null;
  createdAt: string;
  /** Set at the publisher and never read by any consumer. Backlog item 8. */
  correlationId: string;
}

export interface MatchFixedNotification {
  purpose: 'match.fixed';
  matchId: string;
  inviteId: string;
  /** Undefined when enrichment produced no entry for the role. */
  acceptedTeam?: EnrichedTeam;
  hostTeam?: EnrichedTeam;
  rejectedTeams: EnrichedTeam[];
}

export type NotificationEvent = InviteNotification | MatchFixedNotification;

/**
 * The complete routing-key → payload map.
 *
 * D-05: the naming is inconsistent — PascalCase (`TeamDetails`), camelCase
 * (`teamDetailsForRespondingToInvite`) and dot.case (`profilePhoto.updated`) are all
 * in use. Renaming would require coordinated publisher and consumer changes across
 * service boundaries and would drop any message in flight during a deploy, so the
 * names are preserved. Backlog item 13.
 */
export interface EventMap {
  /** media-service → identity-service. Sets `Team.logoUrl`. */
  'profilePhoto.updated': { teamId: string; url: string };

  /** match-service → identity-service. Request for the full team document. */
  'fetchTeamDetails': { teamId: string; matchId: string };

  /** identity-service → match-service. Response to `fetchTeamDetails`. */
  'TeamDetails': TeamDocumentPayload & { matchId: string };

  /** match-service → identity-service. Async fallback when sync enrichment throws. */
  'fetchTeamDetailsForMatchInviteCreated': { receiverTeamId: string; matchId: string };

  /** identity-service → match-service. Projection of Team, plus matchId. */
  'TeamDetailsForMatchInvite': {
    _id: string;
    teamName: string;
    email: string;
    collegeName: string;
    matchId: string;
  };

  /** match-service → identity-service. Batch enrichment request. */
  'fetchTeamDetailsForRespondingToInvite': {
    matchId: string;
    inviteId: string;
    /** Always the literal string 'responding.to.invites' at the current call site. */
    purpose: string;
    teams: Array<{ teamId: string; role: string }>;
  };

  /** identity-service → match-service. Batch enrichment response. */
  'teamDetailsForRespondingToInvite': {
    matchId: string;
    inviteId: string;
    purpose: string;
    enrichedTeams: EnrichedTeam[];
  };

  /** match-service → notification-service. Triggers outbound email. */
  'notification': NotificationEvent;
}

export type RoutingKey = keyof EventMap;
```

- [ ] **Step 2: Build and confirm the types emit**

```bash
npm run build -w @uff/shared
```
Expected: `packages/shared/dist/events.d.ts` exists and declares `EventMap`.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/events.ts
git commit -m "feat(shared): typed contracts for all 8 routing keys (D-05)

Encodes today's shapes including the sync/async divergences under the
'notification' key. Divergences preserved deliberately; see backlog item 2."
```

---

### Task 4: Durable RabbitMQ client

**Files:**
- Create: `packages/shared/src/rabbitmq.ts`

**Interfaces:**
- Consumes: `EventMap`, `RoutingKey`, `EXCHANGE_NAME`, `DLX_NAME`, `DLQ_NAME` from `./events.js`; `Logger` from `./logger.js`
- Produces:
  - `connectToRabbitMQ(url: string, logger: Logger): Promise<void>`
  - `publishEvent<K extends RoutingKey>(routingKey: K, message: EventMap[K]): Promise<void>`
  - `consumeEvent<K extends RoutingKey>(queueName: string, routingKey: K, handler: (payload: EventMap[K]) => Promise<void>): Promise<void>`
  - `closeRabbitMQ(): Promise<void>`

**Context for the implementer:** this replaces four byte-identical copies of `rabbitmq.js`. The original had four defects, all fixed here (D-05):

| Original | Problem | Fix |
|---|---|---|
| `assertExchange(..., { durable: false })` | broker restart drops everything | `durable: true` + `persistent: true` publishes |
| `assertQueue("", { exclusive: true })` | anonymous queue created on connect, deleted on disconnect — events published while a consumer is down are lost forever; two replicas each get their own queue and both process every message | named durable queue, shared across replicas |
| `callback(content); channel.ack(msg);` | the handler is not awaited, so a handler that throws still acks and the failure is dropped | `await handler(...)` then ack; nack to DLX on throw |
| no close on shutdown | channel and connection leak on deploy | `closeRabbitMQ()` wired to SIGTERM |

Note the **signature change**: `consumeEvent` now takes a `queueName` as its first argument. Every call site must supply a stable name — the convention is `<service>.<routingKey>`, e.g. `identity.fetchTeamDetails`. This is what makes replicas share a queue instead of fanning out.

- [ ] **Step 1: Create `packages/shared/src/rabbitmq.ts`**

```ts
import amqp, { type Channel, type ChannelModel } from 'amqplib';
import { EXCHANGE_NAME, DLX_NAME, DLQ_NAME, type EventMap, type RoutingKey } from './events.js';
import type { Logger } from './logger.js';

let connection: ChannelModel | null = null;
let channel: Channel | null = null;
let log: Logger | null = null;

function requireChannel(): Channel {
  if (!channel) {
    throw new Error('RabbitMQ channel not initialised — call connectToRabbitMQ() first');
  }
  return channel;
}

/**
 * Opens the connection and declares the topology. Called once per service from
 * `server.ts`, before any consumer is registered and before the HTTP listener starts.
 *
 * Declares a durable topic exchange plus a dead-letter exchange and queue. Handlers
 * that throw send their message to `football.dlq` rather than dropping it (D-05).
 */
export async function connectToRabbitMQ(url: string, logger: Logger): Promise<void> {
  log = logger;
  connection = await amqp.connect(url);
  channel = await connection.createChannel();

  await channel.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });
  await channel.assertExchange(DLX_NAME, 'fanout', { durable: true });
  await channel.assertQueue(DLQ_NAME, { durable: true });
  await channel.bindQueue(DLQ_NAME, DLX_NAME, '');

  // Bounds how many unacked messages a restarted consumer pulls at once, so it
  // does not inhale an entire accumulated backlog in one go.
  await channel.prefetch(10);

  connection.on('error', (err: Error) => logger.error('RabbitMQ connection error', err));
  connection.on('close', () => logger.warn('RabbitMQ connection closed'));

  logger.info('Connected to RabbitMQ');
}

/**
 * Publishes a typed event. The generic ties `message` to the routing key, so passing
 * a payload that does not match the key is a compile error rather than a runtime
 * surprise in a consumer four hops away.
 */
export async function publishEvent<K extends RoutingKey>(
  routingKey: K,
  message: EventMap[K],
): Promise<void> {
  const ch = requireChannel();
  ch.publish(EXCHANGE_NAME, routingKey, Buffer.from(JSON.stringify(message)), {
    persistent: true,
    contentType: 'application/json',
  });
  log?.info(`Event published with routing key: ${routingKey}`);
}

/**
 * Binds a NAMED DURABLE queue to a routing key and consumes it.
 *
 * `queueName` must be stable across restarts and identical across replicas of the
 * same service — use `<service>.<routingKey>`. This is the change that makes the
 * bus survive a consumer being down and stops two replicas from each processing
 * every message (D-05).
 *
 * The handler is awaited before the ack. A handler that throws nacks without requeue,
 * routing the message to the DLX instead of losing it or spinning forever.
 */
export async function consumeEvent<K extends RoutingKey>(
  queueName: string,
  routingKey: K,
  handler: (payload: EventMap[K]) => Promise<void>,
): Promise<void> {
  const ch = requireChannel();

  await ch.assertQueue(queueName, {
    durable: true,
    deadLetterExchange: DLX_NAME,
  });
  await ch.bindQueue(queueName, EXCHANGE_NAME, routingKey);

  await ch.consume(queueName, (msg) => {
    if (msg === null) return;
    void (async () => {
      try {
        const payload = JSON.parse(msg.content.toString()) as EventMap[K];
        await handler(payload);
        ch.ack(msg);
        log?.info(`Event consumed with routing key: ${routingKey}`);
      } catch (err) {
        log?.error(`Handler failed for ${routingKey}, dead-lettering`, err);
        ch.nack(msg, false, false);
      }
    })();
  });

  log?.info(`Subscribed to ${routingKey} on queue ${queueName}`);
}

/** Wired to SIGTERM so a deploy drains rather than severing in-flight work. */
export async function closeRabbitMQ(): Promise<void> {
  try {
    await channel?.close();
    await connection?.close();
    log?.info('RabbitMQ connection closed cleanly');
  } catch (err) {
    log?.error('Error closing RabbitMQ', err);
  } finally {
    channel = null;
    connection = null;
  }
}
```

- [ ] **Step 2: Verify the amqplib type import matches the installed version**

```bash
npm run build -w @uff/shared
```
Expected: PASS. If it fails on `ChannelModel` not being exported, the installed `@types/amqplib` predates that rename — use `import type { Connection }` and `let connection: Connection | null` instead, and record the substitution in `docs/DECISIONS.md` as a note under D-05.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/rabbitmq.ts
git commit -m "feat(shared): durable RabbitMQ client with DLX and ack-after-handler (D-05)

Replaces 4 byte-identical copies. Fixes: non-durable exchange, anonymous
exclusive queues (silent loss + fan-out on scale-out), ack before the
handler resolves, and no close on shutdown.

BREAKING: consumeEvent now takes a queueName first argument."
```

---

### Task 5: Shared error handler and auth middleware

**Files:**
- Create: `packages/shared/src/errors.ts`
- Create: `packages/shared/src/auth.ts`

**Interfaces:**
- Consumes: `Logger` from `./logger.js`
- Produces:
  - `createErrorHandler(logger: Logger): ErrorRequestHandler`
  - `createValidateToken(secret: string, logger: Logger): RequestHandler` — gateway only
  - `createAuthenticateRequest(logger: Logger): RequestHandler` — downstream services
  - Global `Express.Request.team?: AuthenticatedTeam` augmentation

- [ ] **Step 1: Create `packages/shared/src/errors.ts`**

```ts
import type { ErrorRequestHandler } from 'express';
import type { Logger } from './logger.js';

/** Errors thrown with a `status` are surfaced with that code; anything else is a 500. */
interface HttpError extends Error {
  status?: number;
}

/**
 * Terminal middleware — registered last in every service's `server.ts`, after all
 * routes. Express 5 routes async rejections here automatically, which Express 4 did
 * not; behaviour is otherwise identical to the five copies it replaces.
 */
export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (err: HttpError, _req, res, _next) => {
    logger.error(err.stack ?? err.message);
    res.status(err.status ?? 500).json({
      message: err.message || 'Internal Server Error',
    });
  };
}
```

- [ ] **Step 2: Create `packages/shared/src/auth.ts`**

```ts
import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import type { Logger } from './logger.js';

/**
 * What lands on `req.team`.
 *
 * At the gateway this is the decoded JWT payload. Downstream it is reconstructed
 * from the `x-team-id` header the gateway injected, so only `teamId` is populated.
 *
 * `name` is present because the gateway's JWT carries it — but it is ALWAYS
 * undefined, because `generateToken` signs `team.name` while the Team model's field
 * is `teamName`. Preserved as-is; backlog item 5.
 */
export interface AuthenticatedTeam {
  teamId: string;
  name?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      team?: AuthenticatedTeam;
    }
  }
}

/**
 * Gateway-only. The single place in the whole system where a JWT is actually
 * verified. On success the decoded payload is attached to `req.team`, and the proxy
 * layer forwards `req.team.teamId` downstream as the `x-team-id` header.
 */
export function createValidateToken(secret: string, logger: Logger): RequestHandler {
  return (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      logger.warn('Access attempted without valid token');
      return res.status(401).json({ message: 'Authentication required ! Please Login to continue' });
    }

    jwt.verify(token, secret, (err, decoded) => {
      if (err) {
        logger.error('Token validation failed:', err);
        return res.status(403).json({ message: 'Invalid token' });
      }
      req.team = decoded as AuthenticatedTeam;
      next();
    });
  };
}

/**
 * Downstream services. Reads the `x-team-id` header the gateway injected and trusts
 * it unconditionally — no signature, no shared secret, no verification of any kind.
 *
 * This is an authentication bypass for anyone who can reach a service port directly.
 * It is preserved deliberately: fixing it requires a coordinated change across the
 * gateway and all four downstream services, which is out of scope for this migration.
 * Backlog item 1.
 */
export function createAuthenticateRequest(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const teamId = req.headers['x-team-id'];

    if (!teamId || typeof teamId !== 'string') {
      logger.warn('Access attempted without team ID');
      return res.status(401).json({ message: 'Authentication required ! Please Login to continue' });
    }

    req.team = { teamId };
    logger.info(`User authenticated with ID: ${teamId}`);
    next();
  };
}
```

- [ ] **Step 3: Build and type-check the whole shared package**

```bash
npm run build -w @uff/shared && npm run typecheck -w @uff/shared
```
Expected: both PASS, `dist/` contains `logger.js`, `events.js`, `rabbitmq.js`, `errors.js`, `auth.js` and matching `.d.ts` files.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/errors.ts packages/shared/src/auth.ts
git commit -m "feat(shared): typed error handler and auth middleware (D-03)

Replaces 5 near-identical copies each. The x-team-id trust model is
preserved unchanged and documented in place; see backlog item 1."
```

---

### Task 6: identity-service — package, config, and models

**Files:**
- Create: `identity-service/package.json` (replaces the existing one)
- Create: `identity-service/tsconfig.json`
- Create: `identity-service/src/env.ts`
- Create: `identity-service/src/models/Team.ts`
- Create: `identity-service/src/models/RefreshToken.ts`
- Delete: `identity-service/src/models/Team.js`, `identity-service/src/models/RefreshToken.js`

**Interfaces:**
- Consumes: `@uff/shared` (Tasks 2–5)
- Produces: `env` object; `Team` model with `ITeam` document interface exposing `comparePassword(password: string): Promise<boolean>`; `RefreshToken` model with `IRefreshToken`. Tasks 7 and 8 import these.

- [ ] **Step 1: Resolve versions and write `identity-service/package.json`**

```bash
npm view mongoose version && npm view joi version && npm view argon2 version && npm view ioredis version && npm view helmet version && npm view cors version && npm view dotenv version && npm view tsx version && npm view @types/cors version
```

```json
{
  "name": "identity-service",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "dist/server.js",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "start": "node dist/server.js",
    "dev": "tsx watch src/server.ts"
  },
  "dependencies": {
    "@uff/shared": "*",
    "argon2": "^<resolved>",
    "cors": "^<resolved>",
    "dotenv": "^<resolved>",
    "express": "^<resolved>",
    "helmet": "^<resolved>",
    "ioredis": "^<resolved>",
    "joi": "^<resolved>",
    "jsonwebtoken": "^<resolved>",
    "mongoose": "^<resolved>"
  },
  "devDependencies": {
    "@types/cors": "^<resolved>",
    "@types/express": "^<resolved>",
    "@types/jsonwebtoken": "^<resolved>",
    "@types/node": "^<resolved>",
    "tsx": "^<resolved>",
    "typescript": "^<resolved>"
  },
  "engines": { "node": ">=24" }
}
```

Dropped deliberately, and each is a decision to record in `identity-service/DECISIONS.md`:
- `amqp@0.2.7` — abandoned 2015, never imported; the real client is `amqplib`, now owned by `@uff/shared`
- `amqplib` — moved to `@uff/shared`
- `winston` — moved to `@uff/shared`
- `redis`, `rate-limit-redis`, `rate-limiter-flexible`, `express-rate-limit` — `ioredis` is the client actually used; the rate limiters were entirely commented out in `server.js`. **Keep `rate-limiter-flexible`** if you intend to preserve the `rateLimiter` object that is constructed but never applied; the behavior-preserving reading is that constructing an unused object is not behavior, so dropping it is correct. Record the call either way.

- [ ] **Step 2: Create `identity-service/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create `identity-service/src/env.ts`**

Under `strict`, `process.env.X` is `string | undefined`, so every use would otherwise need a
non-null assertion. Centralising it here means the service fails loudly at boot on a missing
variable instead of failing obscurely on first use.

```ts
import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  PORT: Number(process.env['PORT'] ?? 3001),
  NODE_ENV: process.env['NODE_ENV'] ?? 'development',
  MONGODB_URL: required('MONGODB_URL'),
  REDIS_URL: required('REDIS_URL'),
  RABBITMQ_URL: required('RABBITMQ_URL'),
  JWT_SECRET: required('JWT_SECRET'),
} as const;
```

- [ ] **Step 4: Create `identity-service/src/models/Team.ts`**

```ts
import mongoose, { Schema, type Document, type Model } from 'mongoose';
import argon2 from 'argon2';

export interface ITeam extends Document {
  _id: mongoose.Types.ObjectId;
  teamName: string;
  collegeName: string;
  email: string;
  password: string;
  logoUrl?: string;
  role: 'TEAM' | 'ADMIN';
  createdAt: Date;
  updatedAt: Date;
  comparePassword(password: string): Promise<boolean>;
}

const teamSchema = new Schema<ITeam>(
  {
    teamName: { type: String, required: true, trim: true },
    collegeName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    password: { type: String, required: true, trim: true },
    logoUrl: { type: String },
    role: { type: String, enum: ['TEAM', 'ADMIN'], default: 'TEAM' },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

/**
 * Hashes on save. Runs on registration and on any later password change; the
 * `isModified` guard is what stops a re-save of an unrelated field from
 * double-hashing an already-hashed password.
 */
teamSchema.pre('save', async function (next) {
  if (this.isModified('password')) {
    try {
      this.password = await argon2.hash(this.password);
    } catch (err) {
      return next(err as Error);
    }
  }
  next();
});

teamSchema.methods['comparePassword'] = async function (
  this: ITeam,
  password: string,
): Promise<boolean> {
  try {
    return await argon2.verify(this.password, password);
  } catch {
    throw new Error('Password comparison failed');
  }
};

teamSchema.index({ teamName: 'text' });

export const Team: Model<ITeam> = mongoose.model<ITeam>('Team', teamSchema);
```

- [ ] **Step 5: Create `identity-service/src/models/RefreshToken.ts`**

```ts
import mongoose, { Schema, type Document, type Model } from 'mongoose';

export interface IRefreshToken extends Document {
  _id: mongoose.Types.ObjectId;
  token: string;
  team: mongoose.Types.ObjectId;
  expiresAt: Date;
}

const refreshTokenSchema = new Schema<IRefreshToken>(
  {
    token: { type: String, required: true, unique: true },
    team: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

/** TTL index — Mongo reaps expired refresh tokens without any application sweep. */
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken: Model<IRefreshToken> =
  mongoose.model<IRefreshToken>('RefreshToken', refreshTokenSchema);
```

- [ ] **Step 6: Remove the JavaScript originals**

```bash
git rm identity-service/src/models/Team.js identity-service/src/models/RefreshToken.js
```

- [ ] **Step 7: Install and type-check**

```bash
npm install
npm run build -w @uff/shared
npm run typecheck -w identity-service
```
Expected: PASS. (`server.ts` does not exist yet, so only the models and env are checked.)

- [ ] **Step 8: Commit**

```bash
git add identity-service package.json package-lock.json
git commit -m "refactor(identity): port models and config to TypeScript (D-01)

Drops the dead amqp@0.2.7 dependency and moves winston/amqplib to @uff/shared."
```

---

### Task 7: identity-service — validation, tokens, controller, routes

**Files:**
- Create: `identity-service/src/utils/validation.ts`, `identity-service/src/utils/generateToken.ts`
- Create: `identity-service/src/controllers/identity-controller.ts`
- Create: `identity-service/src/routes/identity-routes.ts`
- Delete: the four corresponding `.js` files

**Interfaces:**
- Consumes: `Team`/`ITeam`, `RefreshToken` (Task 6); `env` (Task 6); `Logger` from `@uff/shared/logger`
- Produces: `createIdentityRouter(logger: Logger): Router`, mounted at `/api/auth` by Task 8

**Note on filenames:** the originals were `identitty-controller.js` (typo) and `routes/identity-service.js` (confusingly named after the service). Renaming during the port is a decision to record as `D-ID-NN` — it changes no behavior because both are internal imports.

- [ ] **Step 1: Create `identity-service/src/utils/validation.ts`**

```ts
import Joi from 'joi';

export interface RegistrationInput {
  teamName: string;
  collegeName: string;
  email: string;
  password: string;
  logoUrl?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

const registrationSchema = Joi.object<RegistrationInput>({
  teamName: Joi.string().min(3).max(50).required(),
  collegeName: Joi.string().min(3).max(50).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(6).max(100).required(),
  logoUrl: Joi.string().optional(),
});

const loginSchema = Joi.object<LoginInput>({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).max(100).required(),
});

export const validateRegistration = (data: unknown) => registrationSchema.validate(data);
export const validateLogin = (data: unknown) => loginSchema.validate(data);
```

- [ ] **Step 2: Create `identity-service/src/utils/generateToken.ts`**

```ts
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../env.js';
import { RefreshToken } from '../models/RefreshToken.js';
import type { ITeam } from '../models/Team.js';

export interface TokenPair {
  accesstoken: string;
  refreshtoken: string;
}

/**
 * Issues the access/refresh pair. Called by registration, login, and refresh.
 *
 * The refresh token is opaque (64 random bytes, hex) and is persisted; the TTL index
 * on RefreshToken.expiresAt reaps it after 7 days. Rotation happens at the call site
 * in `refreshTokenUser`, which deletes the presented token after issuing a new pair.
 *
 * NOTE: `name: team.name` is signed here, but the Team model's field is `teamName`,
 * so this claim is always undefined. Preserved as-is; backlog item 5.
 */
export async function generateToken(team: ITeam): Promise<TokenPair> {
  const accesstoken = jwt.sign(
    {
      teamId: team._id,
      name: (team as unknown as { name?: string }).name,
    },
    env.JWT_SECRET,
    { expiresIn: '15m' },
  );

  const refreshtoken = crypto.randomBytes(64).toString('hex');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  await RefreshToken.create({
    token: refreshtoken,
    team: team._id,
    expiresAt,
  });

  return { accesstoken, refreshtoken };
}
```

- [ ] **Step 3: Create `identity-service/src/controllers/identity-controller.ts`**

```ts
import type { Request, Response } from 'express';
import type { Logger } from '@uff/shared/logger';
import { Team } from '../models/Team.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { validateRegistration, validateLogin } from '../utils/validation.js';
import { generateToken } from '../utils/generateToken.js';

/**
 * Controllers are built by a factory so the logger is injected rather than imported
 * as a module singleton — that is what lets `@uff/shared/logger` be service-agnostic.
 * Called once from `routes/identity-routes.ts`.
 */
export function createIdentityController(logger: Logger) {
  const registration = async (req: Request, res: Response): Promise<Response | void> => {
    logger.info('Team registration started');
    try {
      const { error } = validateRegistration(req.body);
      if (error) {
        logger.warn('Validation error:', error.details[0]?.message);
        return res.status(400).json({ message: error.details[0]?.message });
      }

      const { email, password, teamName, collegeName } = req.body as {
        email: string; password: string; teamName: string; collegeName: string;
      };

      const existing = await Team.findOne({ $or: [{ email }, { teamName }] });
      if (existing) {
        logger.warn('Team Already Exist');
        return res.status(400).json({ message: 'Team Already Exist' });
      }

      const team = new Team({ email, password, collegeName, teamName });
      await team.save();
      logger.info('Team Saved Successfully', team._id);

      const { accesstoken, refreshtoken } = await generateToken(team);
      return res.status(201).json({
        message: 'Team Registered Successfully',
        accesstoken,
        refreshtoken,
      });
    } catch (err) {
      logger.error('Error during registration:', err);
      return res.status(500).json({ message: 'Internal Server Error' });
    }
  };

  const loginUser = async (req: Request, res: Response): Promise<Response | void> => {
    logger.info('Team Login started');
    try {
      const { error } = validateLogin(req.body);
      if (error) {
        logger.warn('Validation error:', error.details[0]?.message);
        return res.status(400).json({ message: error.details[0]?.message });
      }

      const { email, password } = req.body as { email: string; password: string };
      const team = await Team.findOne({ email });
      if (!team) {
        logger.warn('Team Not Found');
        return res.status(404).json({ message: 'Team Not Found' });
      }

      const isValidPassword = await team.comparePassword(password);
      if (!isValidPassword) {
        logger.warn('Password is not valid');
        // Preserved: the original returns 404, not 401, for a bad password.
        return res.status(404).json({ message: 'Invalid Password' });
      }

      const { accesstoken, refreshtoken } = await generateToken(team);
      return res.json({
        accesstoken,
        refreshtoken,
        team: team._id,
        message: 'Team Logged In Successfully',
      });
    } catch (err) {
      logger.error('Error during login:', err);
      return res.status(500).json({ message: 'Internal Server Error' });
    }
  };

  const refreshTokenUser = async (req: Request, res: Response): Promise<Response | void> => {
    logger.info('Refresh Token started');
    try {
      const { refreshtoken } = req.body as { refreshtoken?: string };
      if (!refreshtoken) {
        logger.warn('Refresh token is missing');
        return res.status(400).json({ message: 'Refresh token is missing' });
      }

      const storedToken = await RefreshToken.findOne({ token: refreshtoken });
      if (!storedToken || storedToken.expiresAt < new Date()) {
        logger.warn('Invalid or expired refresh token');
        return res.status(400).json({ message: 'Invalid or expired refresh token' });
      }

      // Preserved: the original passes the ObjectId to findOne, not findById.
      const team = await Team.findById(storedToken.team);
      if (!team) {
        logger.warn('Team not found for the refresh token');
        return res.status(404).json({ message: 'Team not found' });
      }

      const { accesstoken: newAccesstoken, refreshtoken: newRefreshToken } =
        await generateToken(team);

      // Rotation: the presented token is destroyed once the replacement exists.
      await RefreshToken.deleteOne({ _id: storedToken._id });

      return res.json({
        accesstoken: newAccesstoken,
        refreshtoken: newRefreshToken,
        message: 'Tokens refreshed successfully',
      });
    } catch (err) {
      logger.error('Error during refresh token:', err);
      return res.status(500).json({ message: 'Internal Server Error' });
    }
  };

  const logoutUser = async (req: Request, res: Response): Promise<Response | void> => {
    logger.info('Team logout Endpoint hit');
    try {
      const { refreshtoken } = req.body as { refreshtoken?: string };
      if (!refreshtoken) {
        logger.warn('Refresh token is missing');
        return res.status(400).json({ message: 'Refresh token is missing' });
      }
      await RefreshToken.deleteOne({ token: refreshtoken });
      logger.info('Team logged out successfully');
      return res.status(200).json({ message: 'Team logged out successfully' });
    } catch (err) {
      logger.error('Error during logout:', err);
      return res.status(500).json({ message: 'Internal Server Error' });
    }
  };

  /**
   * Read model consumed by match-service's synchronous enrichment path
   * (axios GET /v1/auth/getTeamById/:teamId through the gateway).
   *
   * Returns the full Team document, password hash included. Preserved; backlog item 12.
   */
  const getTeamById = async (req: Request, res: Response): Promise<Response> => {
    const { teamId } = req.params;
    logger.info(`Fetching team with ID ${teamId}`);
    try {
      const team = await Team.findById(teamId);
      if (!team) {
        logger.warn(`Team with ID ${teamId} not found`);
        return res.status(404).json({ message: 'Team not found' });
      }
      return res.status(200).json(team);
    } catch (error) {
      // Fixes a latent crash: the original logged `${id}`, an undefined variable,
      // which threw a ReferenceError inside the catch block.
      logger.error(`Error fetching team with ID ${teamId}:`, error);
      return res.status(500).json({ message: 'Internal server error' });
    }
  };

  return { registration, loginUser, refreshTokenUser, logoutUser, getTeamById };
}
```

- [ ] **Step 4: Create `identity-service/src/routes/identity-routes.ts`**

```ts
import { Router } from 'express';
import type { Logger } from '@uff/shared/logger';
import { createIdentityController } from '../controllers/identity-controller.js';

/**
 * Mounted at `/api/auth` by server.ts. The gateway rewrites `/v1/auth/*` to
 * `/api/auth/*`, and — unlike every other route — does NOT require a valid JWT,
 * because these endpoints are how a token is obtained in the first place.
 */
export function createIdentityRouter(logger: Logger): Router {
  const router = Router();
  const controller = createIdentityController(logger);

  router.post('/register', controller.registration);
  router.post('/login', controller.loginUser);
  router.post('/refresh-token', controller.refreshTokenUser);
  router.post('/logout', controller.logoutUser);
  router.get('/getTeamById/:teamId', controller.getTeamById);

  return router;
}
```

- [ ] **Step 5: Remove the JavaScript originals and type-check**

```bash
git rm identity-service/src/utils/validation.js identity-service/src/utils/generateToken.js \
       identity-service/src/controllers/identitty-controller.js \
       identity-service/src/routes/identity-service.js
npm run typecheck -w identity-service
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add identity-service
git commit -m "refactor(identity): port controller, routes, and utils to TypeScript (D-01)

Behaviour preserved, including the 404-on-bad-password response and the
always-undefined JWT 'name' claim. Fixes one latent ReferenceError in
getTeamById's catch block."
```

---

### Task 8: identity-service — event handlers and server

**Files:**
- Create: `identity-service/src/eventHandlers/identity-event-handlers.ts`
- Create: `identity-service/src/server.ts`
- Delete: `identity-service/src/eventHandlers/identity-event-handlers.js`, `identity-service/src/server.js`, `identity-service/src/utils/logger.js`, `identity-service/src/utils/rabbitmq.js`, `identity-service/src/middleware/errorHandler.js`, `identity-service/src/middleware/authMiddleware.js`

**Interfaces:**
- Consumes: everything from Tasks 2–7
- Produces: the running service. This is the reference `server.ts` the four Phase 1 agents copy the shape of — health endpoint, ordered startup, graceful shutdown.

- [ ] **Step 1: Create `identity-service/src/eventHandlers/identity-event-handlers.ts`**

```ts
import type { Logger } from '@uff/shared/logger';
import { publishEvent } from '@uff/shared/rabbitmq';
import type { EventMap, EnrichedTeam, TeamDocumentPayload } from '@uff/shared/events';
import { Team } from '../models/Team.js';

/**
 * identity-service is the enrichment authority: it owns the Team collection, so every
 * other service asks it for team details over the bus rather than reading the DB.
 *
 * Each handler is registered in server.ts via consumeEvent(queueName, routingKey, handler).
 * All four swallow their errors and return normally — meaning the shared client acks the
 * message. Preserved from the original; note that this makes the new dead-letter queue
 * unreachable from these handlers until the swallowing is removed. Backlog item 14.
 */
export function createEventHandlers(logger: Logger) {
  /** media-service published a new logo URL; write it onto the Team. */
  const handleProfileUploadEvent = async (
    event: EventMap['profilePhoto.updated'],
  ): Promise<void> => {
    logger.info('Handling profile upload event', event);
    const { teamId, url } = event;
    try {
      const team = await Team.findById(teamId);
      if (!team) {
        logger.error(`No team found for id ${teamId}`);
        return;
      }
      team.logoUrl = url;
      await team.save();
      logger.info(`Updated url of team with id ${teamId}`);
    } catch (err) {
      logger.error(`Error updating logo url of team with id ${teamId}`, err);
    }
  };

  /** match-service asked for a full team document to denormalise onto a Match. */
  const handleTeamDetailEvent = async (event: EventMap['fetchTeamDetails']): Promise<void> => {
    logger.info('Handling team detail event', event);
    try {
      const { teamId, matchId } = event;
      const result = await Team.findById(teamId);
      if (!result) {
        logger.error(`No team found for id ${teamId}`);
        throw new Error(`No team found for id ${teamId}`);
      }

      const teamObj = result.toObject() as unknown as TeamDocumentPayload;
      await publishEvent('TeamDetails', { ...teamObj, matchId });
      logger.info(`Published team details of team with id ${teamId}`);
    } catch (err) {
      logger.error(`Error handling team detail event: ${(err as Error).message}`);
    }
  };

  /** Async fallback path for invite creation — a projection, not the whole document. */
  const handleTeamDetailForMatchInviteEvent = async (
    event: EventMap['fetchTeamDetailsForMatchInviteCreated'],
  ): Promise<void> => {
    logger.info('Handling team detail for match Invite event', event);
    try {
      const { receiverTeamId, matchId } = event;
      const result = await Team.findById(receiverTeamId).select('teamName email collegeName');
      if (!result) {
        logger.error(`No team found for id ${receiverTeamId}`);
        throw new Error(`No team found for id ${receiverTeamId}`);
      }

      const teamObj = result.toObject();
      await publishEvent('TeamDetailsForMatchInvite', {
        _id: String(teamObj._id),
        teamName: teamObj.teamName,
        email: teamObj.email,
        collegeName: teamObj.collegeName,
        matchId,
      });
      logger.info(`Published team details of team with id ${receiverTeamId}`);
    } catch (err) {
      logger.error(`Error handling team detail event: ${(err as Error).message}`);
    }
  };

  /**
   * Batch enrichment for the accept-invite flow. Looks up host, accepted, and every
   * rejected team in one pass. A team that cannot be found is pushed with an `error`
   * field rather than omitted, so the consumer's array indices stay aligned.
   */
  const handleTeamDetailForRespondingToInviteEvent = async (
    event: EventMap['fetchTeamDetailsForRespondingToInvite'],
  ): Promise<void> => {
    logger.info('Received fetchTeamDetailsForRespondingToInvite event', event);
    try {
      const { matchId, inviteId, purpose, teams } = event;
      if (!teams || !Array.isArray(teams)) {
        throw new Error("Invalid payload: 'teams' must be an array");
      }

      const enriched: EnrichedTeam[] = [];
      for (const { teamId, role } of teams) {
        try {
          const team = await Team.findById(teamId);
          if (!team) {
            logger.warn(`No team found for id ${teamId}`);
            enriched.push({ teamId, role, error: 'Not found' });
            continue;
          }
          enriched.push({
            teamId,
            role,
            email: team.email,
            collegeName: team.collegeName,
            teamName: team.teamName,
          });
        } catch (err) {
          logger.error(`Error enriching team ${teamId}: ${(err as Error).message}`);
          enriched.push({ teamId, role, error: (err as Error).message });
        }
      }

      await publishEvent('teamDetailsForRespondingToInvite', {
        matchId,
        inviteId,
        purpose,
        enrichedTeams: enriched,
      });
      logger.info('Published teamDetailsForRespondingToInvite');
    } catch (err) {
      logger.error('Error handling fetchTeamDetailsForRespondingToInvite', err);
    }
  };

  return {
    handleProfileUploadEvent,
    handleTeamDetailEvent,
    handleTeamDetailForMatchInviteEvent,
    handleTeamDetailForRespondingToInviteEvent,
  };
}
```

- [ ] **Step 2: Create `identity-service/src/server.ts`**

This is the reference composition root. Note the ordering, which every service must match:
Mongo → Redis → RabbitMQ → consumers → HTTP listener. The listener starts **last** so the
container is never accepting traffic it cannot service. The ~100 lines of commented-out
rate-limiter configuration in the original are dropped (they were dead code, not behavior).

```ts
import { env } from './env.js';
import express from 'express';
import mongoose from 'mongoose';
import helmet from 'helmet';
import cors from 'cors';
import Redis from 'ioredis';
import { createLogger } from '@uff/shared/logger';
import { createErrorHandler } from '@uff/shared/errors';
import { connectToRabbitMQ, consumeEvent, closeRabbitMQ } from '@uff/shared/rabbitmq';
import { createIdentityRouter } from './routes/identity-routes.js';
import { createEventHandlers } from './eventHandlers/identity-event-handlers.js';

const logger = createLogger('identity-service');
const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use((req, _res, next) => {
  logger.info(`Received ${req.method} Request to ${req.url}`);
  next();
});

/**
 * Liveness + readiness. docker-compose health-checks this, and it is the only way to
 * know the service came up cleanly — the project previously had no probe of any kind.
 */
app.get('/health', (_req, res) => {
  const mongoReady = mongoose.connection.readyState === 1;
  res.status(mongoReady ? 200 : 503).json({
    service: 'identity-service',
    status: mongoReady ? 'ok' : 'degraded',
    mongo: mongoose.connection.readyState,
  });
});

app.use('/api/auth', createIdentityRouter(logger));
app.use(createErrorHandler(logger));

const redisClient = new Redis(env.REDIS_URL);
redisClient.on('connect', () => logger.info('Connected to Redis'));
redisClient.on('error', (err) => logger.error('Error connecting to Redis:', err));

async function startServer(): Promise<void> {
  try {
    await mongoose.connect(env.MONGODB_URL);
    logger.info('Connected to MongoDB');

    await connectToRabbitMQ(env.RABBITMQ_URL, logger);

    const handlers = createEventHandlers(logger);

    // Queue names are `<service>.<routingKey>` — stable across restarts and shared
    // across replicas, which is what stops fan-out duplicate processing (D-05).
    await consumeEvent(
      'identity.profilePhoto.updated', 'profilePhoto.updated', handlers.handleProfileUploadEvent,
    );
    await consumeEvent(
      'identity.fetchTeamDetails', 'fetchTeamDetails', handlers.handleTeamDetailEvent,
    );
    await consumeEvent(
      'identity.fetchTeamDetailsForMatchInviteCreated',
      'fetchTeamDetailsForMatchInviteCreated',
      handlers.handleTeamDetailForMatchInviteEvent,
    );
    await consumeEvent(
      'identity.fetchTeamDetailsForRespondingToInvite',
      'fetchTeamDetailsForRespondingToInvite',
      handlers.handleTeamDetailForRespondingToInviteEvent,
    );

    const server = app.listen(env.PORT, () => {
      logger.info(`identity-service is running on port ${env.PORT}`);
    });

    /**
     * Graceful shutdown. Stops accepting connections, then closes the bus and the
     * datastores. Without this, a deploy severs in-flight requests and leaks the
     * RabbitMQ channel — issue 11 in the architecture docs.
     */
    const shutdown = async (signal: string): Promise<void> => {
      logger.info(`${signal} received, shutting down`);
      server.close(() => logger.info('HTTP server closed'));
      await closeRabbitMQ();
      await mongoose.connection.close();
      redisClient.disconnect();
      process.exit(0);
    };

    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
  } catch (err) {
    logger.error('Error starting server:', err);
    process.exit(1);
  }
}

void startServer();

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception, exiting:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Delete the superseded JavaScript files**

```bash
git rm identity-service/src/server.js \
       identity-service/src/eventHandlers/identity-event-handlers.js \
       identity-service/src/utils/logger.js \
       identity-service/src/utils/rabbitmq.js \
       identity-service/src/middleware/errorHandler.js \
       identity-service/src/middleware/authMiddleware.js
rmdir identity-service/src/middleware 2>/dev/null || true
```

`authMiddleware.js` goes because identity-service never actually used it — it was copy-pasted in and never mounted. Record as `D-ID-NN`.

- [ ] **Step 4: Type-check and build**

```bash
npm run build -w @uff/shared && npm run typecheck -w identity-service && npm run build -w identity-service
```
Expected: all PASS, `identity-service/dist/server.js` exists.

- [ ] **Step 5: Confirm no JavaScript source remains**

```bash
find identity-service/src -name '*.js'
```
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add identity-service
git commit -m "refactor(identity): port event handlers and server to TypeScript (D-01, D-05)

Adds /health and SIGTERM graceful shutdown. Consumers now bind named
durable queues (identity.<routingKey>). Drops ~100 lines of commented-out
rate limiter config and the never-mounted authMiddleware copy."
```

---

### Task 9: identity-service documentation, Dockerfile, and the Phase 0 gate

**Files:**
- Modify: `identity-service/Dockerfile`
- Create: `identity-service/DECISIONS.md`
- Create: `identity-service/FLOW.md`

**Interfaces:**
- Consumes: everything in Phase 0
- Produces: the `main` commit that all four Phase 1 worktrees branch from

- [ ] **Step 1: Rewrite `identity-service/Dockerfile` as a multi-stage build**

TypeScript needs a build step, so the image now compiles in one stage and ships only `dist/`
plus production dependencies. The base moves from `node:18-alpine` (EOL April 2025) to
`node:24-alpine`. Build context is the **repo root**, because the workspace layout means
`packages/shared` must be present.

```dockerfile
# Build stage — compiles the shared package and this service.
FROM node:24-alpine AS build
WORKDIR /usr/src/app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY identity-service/package.json identity-service/
RUN npm ci --workspace @uff/shared --workspace identity-service --include-workspace-root
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY identity-service identity-service
RUN npm run build -w @uff/shared && npm run build -w identity-service

# Runtime stage — production dependencies and compiled output only.
FROM node:24-alpine AS runtime
WORKDIR /usr/src/app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY identity-service/package.json identity-service/
RUN npm ci --omit=dev --workspace @uff/shared --workspace identity-service --include-workspace-root
COPY --from=build /usr/src/app/packages/shared/dist packages/shared/dist
COPY --from=build /usr/src/app/identity-service/dist identity-service/dist
EXPOSE 3001
CMD ["node", "identity-service/dist/server.js"]
```

- [ ] **Step 2: Verify the image builds**

```bash
docker build -f identity-service/Dockerfile -t uff/identity-service:dev .
```
Expected: build succeeds. Note the trailing `.` — the context is the repo root, not the service directory.

- [ ] **Step 3: Create `identity-service/DECISIONS.md`**

Record every judgment call made in Tasks 6–8. Use this structure, one entry per decision, and number them `D-ID-01` onward:

```markdown
# identity-service — Decision Log

Service-level decisions from the TypeScript port. Root decisions live in `docs/DECISIONS.md`.
Commits cite these IDs.

## D-ID-01 — Dropped `amqp@0.2.7`

**Decision:** removed from `package.json`.
**Why:** abandoned in 2015, never imported anywhere in the service. The real AMQP client is
`amqplib`, which now lives in `@uff/shared`.

## D-ID-02 — Dropped the rate-limiting dependencies

**Decision:** removed `express-rate-limit`, `rate-limit-redis`, `rate-limiter-flexible`, and `redis`.
**Why:** every rate limiter in `server.js` was commented out. The one `RateLimiterRedis` instance
that was constructed was never applied to any route, so removing it changes no observable
behaviour. `redis` was installed alongside `ioredis`; only `ioredis` was used.
**Risk:** re-enabling rate limiting later means re-adding a dependency. Backlog item 7.

## D-ID-03 — Renamed `identitty-controller.js` → `identity-controller.ts`

**Decision:** fixed the typo; also renamed `routes/identity-service.js` → `routes/identity-routes.ts`.
**Why:** both are internal imports with no external consumers, so the rename is behaviour-neutral.
The old route filename was confusingly identical to the service name.

## D-ID-04 — Deleted the unused `authMiddleware.js`

**Decision:** removed rather than ported.
**Why:** copy-pasted from the service template and never mounted in `server.js`. identity-service
is reached through the gateway without a JWT check, so it has no authentication middleware by design.

## D-ID-05 — Controllers and handlers built by factory functions

**Decision:** `createIdentityController(logger)` / `createEventHandlers(logger)` instead of
module-level singletons.
**Why:** `@uff/shared/logger` exports `createLogger(serviceName)` rather than a pre-built instance,
so the logger has to be injected. Factories are the smallest change that achieves that.

## D-ID-06 — Fixed a latent `ReferenceError` in `getTeamById`

**Decision:** the catch block logged `${id}`, an undefined variable, which threw inside the error
path. Changed to `${teamId}`.
**Why:** this is the one place the behaviour-preserving rule was broken deliberately — the original
"behaviour" was a crash in the error handler that masked the real error. Recorded here so the
deviation is traceable.
```

Add any further decisions the implementation actually required. If none beyond these were made, say so explicitly rather than leaving the file looking incomplete.

- [ ] **Step 4: Create `identity-service/FLOW.md`**

```markdown
# identity-service — Execution Flow

How execution actually travels through this service. Companion to
`docs/architecture/02-identity-service.md`, which describes the service from the outside;
this describes it from the inside.

## Startup order (`src/server.ts`)

`env.ts` loads and validates environment variables at import time — a missing variable throws
here, before anything connects.

1. `createLogger('identity-service')`
2. Express middleware: `helmet` → `cors` → `express.json` → request logger
3. `GET /health` registered (reports `mongoose.connection.readyState`)
4. `/api/auth` router mounted
5. `createErrorHandler` registered last — Express 5 routes async rejections here automatically
6. Redis client constructed (event handlers only; no request path uses it)
7. `startServer()`: Mongo connect → RabbitMQ connect → 4 consumers registered → **then** `app.listen`

The listener starts last on purpose: the container never accepts traffic it cannot service.

8. `SIGTERM`/`SIGINT` → `shutdown()`: stop accepting → close RabbitMQ → close Mongo → disconnect Redis

## HTTP request paths

All arrive from the gateway, which rewrites `/v1/auth/*` → `/api/auth/*`.
**No JWT is required on any of these** — this is where tokens are issued.

| Route | Controller | Touches |
|---|---|---|
| `POST /api/auth/register` | `registration` | `validateRegistration` → `Team.findOne` (dup check) → `new Team().save()` (pre-save hook argon2-hashes) → `generateToken` |
| `POST /api/auth/login` | `loginUser` | `validateLogin` → `Team.findOne` → `team.comparePassword` (argon2.verify) → `generateToken` |
| `POST /api/auth/refresh-token` | `refreshTokenUser` | `RefreshToken.findOne` → expiry check → `Team.findById` → `generateToken` → `RefreshToken.deleteOne` (rotation) |
| `POST /api/auth/logout` | `logoutUser` | `RefreshToken.deleteOne` |
| `GET /api/auth/getTeamById/:teamId` | `getTeamById` | `Team.findById` → returns the full document |

`getTeamById` is the one route another service calls: match-service hits it via axios through the
gateway during synchronous enrichment. It is on the hot path of the invite flow.

`generateToken` is shared by three of the five routes. It signs a 15-minute HS256 access token and
persists an opaque 64-byte refresh token whose TTL index reaps it after 7 days.

## Event paths (`src/eventHandlers/identity-event-handlers.ts`)

This service is the enrichment authority — it owns the `Team` collection, so every other service
asks it for team data over the bus rather than reading the database.

| Queue | Routing key | Handler | Publishes |
|---|---|---|---|
| `identity.profilePhoto.updated` | `profilePhoto.updated` | `handleProfileUploadEvent` | — (writes `Team.logoUrl`) |
| `identity.fetchTeamDetails` | `fetchTeamDetails` | `handleTeamDetailEvent` | `TeamDetails` |
| `identity.fetchTeamDetailsForMatchInviteCreated` | `fetchTeamDetailsForMatchInviteCreated` | `handleTeamDetailForMatchInviteEvent` | `TeamDetailsForMatchInvite` |
| `identity.fetchTeamDetailsForRespondingToInvite` | `fetchTeamDetailsForRespondingToInvite` | `handleTeamDetailForRespondingToInviteEvent` | `teamDetailsForRespondingToInvite` |

All four handlers catch their own errors and return normally, so `@uff/shared/rabbitmq` acks the
message. **The dead-letter queue is therefore unreachable from this service** until the internal
try/catch blocks are removed. Preserved from the original; backlog item 14.

## What the port changed

- `rabbitmq.js`, `logger.js`, `errorHandler.js` → `@uff/shared` (behaviour changed only for the bus, per D-05)
- `authMiddleware.js` deleted — never mounted (D-ID-04)
- `consumeEvent` call sites gained a queue-name argument; anonymous exclusive queues became named durable ones
- `GET /health` added — did not previously exist
- `SIGTERM`/`SIGINT` shutdown added — did not previously exist
- `uncaughtException` handler added; `unhandledRejection` behaviour unchanged (logs, does not exit)
- ~100 lines of commented-out rate limiter config removed
- Controllers/handlers became factories taking a logger (D-ID-05)

## What the port did NOT change

- The `x-team-id` trust model (this service does not use it, but the shared middleware preserves it)
- The always-undefined `name` claim in the JWT
- `login` returning **404** rather than 401 for a bad password
- `getTeamById` returning the password hash in its response body
- `handleTeamDetailEvent` publishing the password hash onto the bus
```

- [ ] **Step 5: Full Phase 0 verification**

```bash
npm run build -w @uff/shared
npm run typecheck -w identity-service
npm run build -w identity-service
find identity-service/src -name '*.js' | wc -l    # expect 0
git ls-files | grep -c '\.log$'                   # expect 0
docker build -f identity-service/Dockerfile -t uff/identity-service:dev .
```
All must pass before proceeding. Do not continue to Phase 1 on a partial result.

- [ ] **Step 6: Commit and merge to `main`**

```bash
git add identity-service docs/
git commit -m "docs(identity): add DECISIONS.md and FLOW.md; Node 24 multi-stage Dockerfile

Completes Phase 0. Base image moves off EOL node:18-alpine."
git checkout main
git merge --no-ff migrate/foundation
```

- [ ] **Step 7: Confirm the gate is closed**

```bash
git log --oneline -1 main
ls packages/shared/dist/
```
Expected: `main` contains the Phase 0 work and `packages/shared/dist` is populated. **Phase 1 cannot begin until this is true** — the worktrees branch from this commit, and an agent that branches earlier gets a repo with a missing `@uff/shared` dependency.

---

# PHASE 1 — Parallel service ports (four agents, four worktrees)

---

### Task 10: Create the four worktrees

**Files:**
- Creates four sibling directories outside the repository

**Interfaces:**
- Consumes: the Phase 0 commit on `main`
- Produces: four isolated working directories, each on its own branch

- [ ] **Step 1: Confirm `main` is clean and current**

```bash
git checkout main
git status --porcelain    # expect no output
```

- [ ] **Step 2: Create the worktrees**

```bash
git worktree add ../uff-api-gateway          -b migrate/api-gateway          main
git worktree add ../uff-match-service        -b migrate/match-service        main
git worktree add ../uff-media-service        -b migrate/media-service        main
git worktree add ../uff-notification-service -b migrate/notification-service main
```

- [ ] **Step 3: Verify each worktree has the shared package**

```bash
git worktree list
for d in ../uff-api-gateway ../uff-match-service ../uff-media-service ../uff-notification-service; do
  echo "$d: $(test -f $d/packages/shared/src/rabbitmq.ts && echo OK || echo MISSING)"
done
```
Expected: four `OK`. A `MISSING` means the worktree branched from the wrong commit — delete and recreate it before dispatching any agent.

- [ ] **Step 4: Install dependencies in each worktree**

```bash
for d in ../uff-api-gateway ../uff-match-service ../uff-media-service ../uff-notification-service; do
  (cd "$d" && npm install && npm run build -w @uff/shared)
done
```
Each worktree gets its own `node_modules`. The shared package must be **built** in each, because the `exports` map points at `dist/`.

---

### Tasks 11–14: The four service ports

Each of these runs as an independent agent in its own worktree. They share the brief below; only the service-specific section differs.

## Common brief — given verbatim to every Phase 1 agent

> You are porting **one** microservice to TypeScript + ESM in an isolated git worktree. Four agents are working in parallel on four other services; you cannot see their work and they cannot see yours.
>
> **Read first, in this order:**
> 1. `docs/superpowers/specs/2026-08-16-typescript-migration-design.md` — the design you are implementing
> 2. `docs/DECISIONS.md` — decisions D-01…D-09 and why
> 3. `docs/architecture/0N-<your-service>.md` — the as-built description of your service, including its known defects
> 4. `identity-service/` — **the reference implementation.** It is already fully ported. Match its structure: `env.ts`, factory functions taking a logger, health endpoint, ordered startup, graceful shutdown.
> 5. `identity-service/FLOW.md` and `identity-service/DECISIONS.md` — the documentation shape yours must match
>
> **You may modify:** only your own service directory.
>
> **You must NOT modify:** `packages/shared`, `docs/DECISIONS.md`, the root `package.json`, `tsconfig.base.json`, any other service directory, or `/src`.
>
> **If you need a change in `packages/shared`:** stop and report it. Do not patch it locally. Four worktrees silently editing the same shared file is the one failure mode that poisons every branch at once, and it stays invisible until merge.
>
> **Do not commit `package-lock.json`.** The root lockfile is regenerated once after all four branches merge. Four agents each committing a regenerated 191KB lockfile guarantees four conflicting versions.
>
> **Rules:**
> - `"type": "module"` in your service's `package.json`; `"engines": { "node": ">=24" }`
> - Relative imports carry explicit `.js` extensions: `import { x } from './utils/x.js'`
> - `strict: true`; no `any` without an adjacent comment explaining why
> - **Behavior-preserving.** Change the language, not the semantics. Where the existing code is inconsistent or wrong, reproduce it and record the defect. The event-bus fixes are already done for you inside `@uff/shared` — you consume them, you do not reimplement them.
> - `consumeEvent` now takes a **queue name first**: `consumeEvent('<yourservice>.<routingKey>', '<routingKey>', handler)`. This is a signature change from the old copy-pasted client.
> - Delete `src/utils/rabbitmq.js`, `src/utils/logger.js`, `src/middleware/errorHandler.js`, and `src/middleware/authMiddleware.js` — all four now come from `@uff/shared`.
> - Drop the commented-out rate-limiter blocks. They are dead code, not behavior.
> - Add `GET /health` and `SIGTERM`/`SIGINT` graceful shutdown, matching identity-service.
> - Move `winston`, `amqplib`, and `jsonwebtoken` out of your `package.json` where they are now only used via `@uff/shared`.
> - Resolve dependency versions with `npm view <pkg> version`. Never write a version from memory.
>
> **Deliverables:**
> 1. Service fully ported; `find <service>/src -name '*.js'` returns nothing
> 2. `npm run typecheck -w <service>` passes under `strict`
> 3. `npm run build -w <service>` passes
> 4. Service boots against its dependencies
> 5. A multi-stage `Dockerfile` on `node:24-alpine`, built from the **repo root** context (copy identity-service's and adapt the port and paths)
> 6. `<service>/DECISIONS.md` — every judgment call, IDs prefixed `<PREFIX>-NN`
> 7. `<service>/FLOW.md` — startup order, HTTP paths table, event paths table, "what the port changed", "what the port did NOT change"
> 8. Non-obvious logic commented in the flow-explaining style: what the block is for, what calls into it, what assumes it exists. Not restating what the code already says.
>
> **Commit** in small increments citing decision IDs. Leave your branch ready to merge; do not merge it yourself.

---

### Task 11: Port `api-gateway`

**Worktree:** `../uff-api-gateway` · **Branch:** `migrate/api-gateway` · **Decision prefix:** `D-GW-`

**Files:**
- Create: `api-gateway/tsconfig.json`, `src/env.ts`, `src/server.ts`
- Modify: `api-gateway/package.json`, `api-gateway/Dockerfile`
- Delete: `src/server.js`, `src/utils/logger.js`, `src/middleware/authMiddleware.js`, `src/middleware/errorhandler.js`
- Create: `api-gateway/DECISIONS.md`, `api-gateway/FLOW.md`

**Interfaces:**
- Consumes: `createLogger`, `createErrorHandler`, `createValidateToken` from `@uff/shared`
- Produces: nothing other services import — this is the edge

**Service-specific notes:**
- 4 files, 222 LOC — the smallest port.
- This is the **only** component that verifies a JWT. Use `createValidateToken(env.JWT_SECRET, logger)` from `@uff/shared/auth`; do not reimplement it.
- Three proxies: `/v1/auth` → identity (**no** `validateToken` — this is where tokens are issued), `/v1/media` → media (with `validateToken`), `/v1/match` → match (with `validateToken`).
- `proxyReqPathResolver` rewrites `^/v1` → `/api`. Preserve exactly.
- The media proxy reads `srcReq.headers['content-type']` and calls `.startsWith()` on it. Under `strict` that is `string | undefined` and will not compile. **A request with no `Content-Type` header currently crashes this proxy** — preserve the crash-free reading by guarding with `?.startsWith(...) ?? false`, and record it as a `D-GW-NN` decision explaining that the guard fixes a latent 500.
- `express-http-proxy` has no bundled types. Check `npm view @types/express-http-proxy version`; if none exists, add a minimal `src/types/express-http-proxy.d.ts` module declaration and record the decision.
- `app.set('trust proxy', 1)` must be preserved — rate limiting keys on `req.ip`.
- The commented-out post-service and search-service proxy blocks are dead code; drop them.
- The rate limiter here **is** active (unlike other services). Keep `express-rate-limit` + `rate-limit-redis` + `ioredis`.
- No RabbitMQ, no MongoDB. `/health` should report Redis reachability only.

---

### Task 12: Port `media-service`

**Worktree:** `../uff-media-service` · **Branch:** `migrate/media-service` · **Decision prefix:** `D-MD-`

**Files:**
- Create: `media-service/tsconfig.json`, `src/env.ts`, `src/server.ts`, `src/models/Media.ts`, `src/controllers/media-controller.ts`, `src/routes/media-routes.ts`, `src/eventHandlers/media-event-handlers.ts`, `src/utils/cloudinary.ts`
- Modify: `media-service/package.json`, `media-service/Dockerfile`
- Delete: the corresponding `.js` files plus the four now-shared utilities
- Create: `media-service/DECISIONS.md`, `media-service/FLOW.md`

**Interfaces:**
- Consumes: `@uff/shared` logger/errors/auth/rabbitmq; `EventMap['profilePhoto.updated']`
- Produces: publishes `profilePhoto.updated`

**Service-specific notes:**
- 10 files, 447 LOC.
- Publishes exactly one event: `publishEvent('profilePhoto.updated', { url, teamId })` — both fields stringified at the call site. The typed contract already matches; no shape change.
- Uses the `redis` package rather than `ioredis` (the only service that does). Preserve or switch — either is defensible, but **record the decision**, because it is the kind of inconsistency a future reader will assume was accidental.
- `multer` 2.x: type the upload with `multer.Multer` and `Express.Multer.File`. `req.file` is `Express.Multer.File | undefined` under `strict` — the existing `if (!mediaFile)` guard already handles it.
- Cloudinary v2 ships its own types; `uploadMediaToCloudinary` needs an explicit return type.
- Uses `createAuthenticateRequest` (trusts `x-team-id`), not `createValidateToken`.
- `joi` is installed but unused — drop it and record why.
- Rate limiting **is** active here. Keep the relevant dependencies.

---

### Task 13: Port `notification-service`

**Worktree:** `../uff-notification-service` · **Branch:** `migrate/notification-service` · **Decision prefix:** `D-NT-`

**Files:**
- Create: `notification-service/tsconfig.json`, `src/env.ts`, `src/server.ts`, `src/models/Notification.ts`, `src/services/notificationService.ts`, `src/utils/mailer.ts`, `src/utils/templates.ts`
- Modify: `notification-service/package.json`, `notification-service/Dockerfile`
- Delete: the corresponding `.js` files plus the four now-shared utilities
- Create: `notification-service/DECISIONS.md`, `notification-service/FLOW.md`

**Interfaces:**
- Consumes: `EventMap['notification']` — the `NotificationEvent` union
- Produces: outbound email only

**Service-specific notes:**
- 9 files, 616 LOC. **No HTTP API at all** — it consumes one routing key and sends mail.
- Add a Dockerfile; this service has none today.
- `mongoose` is imported by `src/models/Notification.js` but **not declared** in `package.json` — it currently resolves only through npm hoisting and would break under `npm ci` in an isolated container. Declare it explicitly and record as a `D-NT-NN` decision. (`match-service` has the same defect; see Task 14.)
- Consumes with `consumeEvent('notification.notification', 'notification', handler)`.
- The handler switches on `event.purpose`. Because `NotificationEvent` is a discriminated union with `purpose` **optional** on `InviteNotification`, narrowing needs care: `case 'invite'` narrows correctly, `default` catches the `purpose: undefined` case. Preserve the `default → logger.warn` branch exactly.
- **Important — do not "fix" this:** `handleInvite` destructures `{ hostTeam, acceptedTeam }`, but the invite payload published by match-service carries `{ sender, receiver }`. These do not match, and the sync path additionally omits `purpose` entirely. This is the dual-path divergence the migration preserves (D-05, backlog item 2). Type it faithfully — expect `hostTeam` to be possibly-undefined and reproduce the resulting behavior rather than repairing it. **Record this prominently in your `FLOW.md`.**
- `handleMatchFixed` reads `{ hostTeam, acceptedTeam, rejectedTeams }`; all three are optional in the contract. Guard exactly as the original did (it did not guard — reproduce that, but the compiler will force you to acknowledge it; use a non-null assertion with a comment citing backlog item 2 rather than adding a new guard that changes behavior).
- `app.use(authenticateRequest)` is applied globally with no routes mounted behind it — effectively dead. Record the decision to keep or drop it.
- `express`, `cors`, `helmet` are still needed for the health endpoint.
- `axios` and `express-http-proxy` are installed but unused — drop them and record why.

---

### Task 14: Port `match-service`

**Worktree:** `../uff-match-service` · **Branch:** `migrate/match-service` · **Decision prefix:** `D-MT-`

**Files:**
- Create: `match-service/tsconfig.json`, `src/env.ts`, `src/server.ts`, `src/models/Match.ts`, `src/models/MatchInvite.ts`, `src/controllers/match-controller.ts`, `src/controllers/match-invite-controller.ts`, `src/routes/matchRoutes.ts`, `src/routes/inviteRoutes.ts`, `src/eventHandlers/match-event-handlers.ts`
- Modify: `match-service/package.json`, `match-service/Dockerfile`
- Delete: the corresponding `.js` files plus the four now-shared utilities
- Create: `match-service/DECISIONS.md`, `match-service/FLOW.md`

**Interfaces:**
- Consumes: `EventMap` keys `TeamDetails`, `TeamDetailsForMatchInvite`, `teamDetailsForRespondingToInvite`
- Produces: publishes `fetchTeamDetails`, `fetchTeamDetailsForMatchInviteCreated`, `fetchTeamDetailsForRespondingToInvite`, `notification`

**Service-specific notes:**
- 12 files, 961 LOC — **the largest port, roughly 4× api-gateway.** Expect this agent to run longest. Checkpoint after the models and before the invite controller.
- Add a Dockerfile; this service has none today.
- `mongoose` is imported but **not declared** in `package.json` — it currently resolves only through npm hoisting and would break under `npm ci`. Declare it explicitly and record as a `D-MT-NN` decision.
- Publishes four of the eight routing keys and consumes three. Every one is already typed in `@uff/shared/events`; if a payload does not type-check, the contract is describing reality and **your call site is the thing that must match it** — do not widen the contract, and do not edit `packages/shared`. Report the mismatch.
- **The dual-path enrichment is here, and it must be preserved exactly** (D-05, backlog item 2):
  - `createInvite`: `Promise.allSettled` of two axios calls with a 700 ms timeout → on success publishes `notification` **without `purpose`**; on throw publishes `fetchTeamDetailsForMatchInviteCreated` instead.
  - `respondToInvite`: sequential axios enrichment → on success publishes `notification` with `purpose: 'match.fixed'`; on throw publishes `fetchTeamDetailsForRespondingToInvite`.
  - The commented-out `purpose: 'invite'` line in `createInvite` stays commented out. It is the reason invite emails are never sent through the sync path. Preserving it is the point.
- `axios` calls hardcode `http://localhost:3000` for gateway callbacks. **Preserve the behavior**, but move the value into `env.ts` as `GATEWAY_URL` defaulting to `http://localhost:3000` — that is a refactor with an identical default, and it is what makes the service reachable inside docker-compose in Phase 2. Record as a `D-MT-NN` decision.
- Uses `createAuthenticateRequest` (trusts `x-team-id`), not `createValidateToken`.
- `rejectedTeamIds` is computed with `senderTeamIds.filter(id => id !== acceptedTeamId)`, comparing ObjectIds by reference. Under `strict` this will surface as a type question. **Preserve the existing comparison semantics** and record what you found — changing it changes which teams get rejection emails.

---

# PHASE 2 — Integration

---

### Task 15: Merge the four branches and regenerate the lockfile

**Files:**
- Modify: `package-lock.json`

- [ ] **Step 1: Confirm all four branches are complete**

```bash
for b in api-gateway match-service media-service notification-service; do
  echo "== migrate/$b"
  git log --oneline main..migrate/$b | head -5
done
```

- [ ] **Step 2: Merge sequentially**

```bash
git checkout main
git merge --no-ff migrate/api-gateway
git merge --no-ff migrate/media-service
git merge --no-ff migrate/notification-service
git merge --no-ff migrate/match-service
```
Expected: no conflicts. If one occurs, it means an agent modified a file outside its service directory — inspect with `git diff --name-only main migrate/<branch>` before resolving, because that is a rule violation worth understanding rather than merely fixing.

- [ ] **Step 3: Regenerate the lockfile once, for all workspaces**

```bash
rm -rf node_modules package-lock.json
npm install
```

- [ ] **Step 4: Verify no JavaScript sources remain in the five services**

```bash
find api-gateway/src identity-service/src match-service/src media-service/src notification-service/src -name '*.js' | wc -l
```
Expected: `0`. (`/src`, the legacy monolith, is intentionally excluded from this check.)

- [ ] **Step 5: Type-check and build the entire workspace**

```bash
npm run build -w @uff/shared
npm run typecheck
npm run build
```
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add package-lock.json
git commit -m "chore: merge all four service ports and regenerate lockfile (D-07)"
```

- [ ] **Step 7: Clean up the worktrees**

```bash
git worktree remove ../uff-api-gateway
git worktree remove ../uff-media-service
git worktree remove ../uff-notification-service
git worktree remove ../uff-match-service
git worktree list
```

---

### Task 16: `docker-compose.yml`

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.example`

**Interfaces:**
- Consumes: the five Dockerfiles
- Produces: the running stack the smoke test asserts against

- [ ] **Step 1: Create `.env.example`**

```dotenv
JWT_SECRET=change-me-in-production
MONGO_INITDB_ROOT_USERNAME=root
MONGO_INITDB_ROOT_PASSWORD=example
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
SMTP_USER=
SMTP_PASS=
```

`.gitignore` already excludes `.env` and `.env.example`; remove `.env.example` from `.gitignore` so the template is tracked — an untracked example file helps nobody.

- [ ] **Step 2: Create `docker-compose.yml`**

```yaml
services:
  mongo:
    image: mongo:8
    ports: ["27017:27017"]
    volumes: [mongo-data:/data/db]
    healthcheck:
      test: ["CMD", "mongosh", "--eval", "db.adminCommand('ping')"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  rabbitmq:
    image: rabbitmq:4-management-alpine
    ports: ["5672:5672", "15672:15672"]
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  identity-service:
    build: { context: ., dockerfile: identity-service/Dockerfile }
    ports: ["3001:3001"]
    environment:
      PORT: 3001
      MONGODB_URL: mongodb://mongo:27017/uff-identity
      REDIS_URL: redis://redis:6379
      RABBITMQ_URL: amqp://rabbitmq:5672
      JWT_SECRET: ${JWT_SECRET}
    depends_on:
      mongo: { condition: service_healthy }
      redis: { condition: service_healthy }
      rabbitmq: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 5

  media-service:
    build: { context: ., dockerfile: media-service/Dockerfile }
    ports: ["3003:3003"]
    environment:
      PORT: 3003
      MONGODB_URL: mongodb://mongo:27017/uff-media
      REDIS_URL: redis://redis:6379
      RABBITMQ_URL: amqp://rabbitmq:5672
      CLOUDINARY_CLOUD_NAME: ${CLOUDINARY_CLOUD_NAME}
      CLOUDINARY_API_KEY: ${CLOUDINARY_API_KEY}
      CLOUDINARY_API_SECRET: ${CLOUDINARY_API_SECRET}
    depends_on:
      mongo: { condition: service_healthy }
      redis: { condition: service_healthy }
      rabbitmq: { condition: service_healthy }

  match-service:
    build: { context: ., dockerfile: match-service/Dockerfile }
    ports: ["3004:3004"]
    environment:
      PORT: 3004
      MONGODB_URL: mongodb://mongo:27017/uff-match
      REDIS_URL: redis://redis:6379
      RABBITMQ_URL: amqp://rabbitmq:5672
      # match-service calls back through the gateway for synchronous enrichment.
      # This replaces the hardcoded http://localhost:3000 (D-MT-NN).
      GATEWAY_URL: http://api-gateway:3000
    depends_on:
      mongo: { condition: service_healthy }
      rabbitmq: { condition: service_healthy }

  notification-service:
    build: { context: ., dockerfile: notification-service/Dockerfile }
    ports: ["3005:3005"]
    environment:
      PORT: 3005
      MONGODB_URL: mongodb://mongo:27017/uff-notification
      REDIS_URL: redis://redis:6379
      RABBITMQ_URL: amqp://rabbitmq:5672
      SMTP_USER: ${SMTP_USER}
      SMTP_PASS: ${SMTP_PASS}
    depends_on:
      mongo: { condition: service_healthy }
      rabbitmq: { condition: service_healthy }

  api-gateway:
    build: { context: ., dockerfile: api-gateway/Dockerfile }
    ports: ["3000:3000"]
    environment:
      PORT: 3000
      REDIS_URL: redis://redis:6379
      JWT_SECRET: ${JWT_SECRET}
      IDENTITY_SERVICE_URL: http://identity-service:3001
      MEDIA_SERVICE_URL: http://media-service:3003
      MATCH_SERVICE_URL: http://match-service:3004
    depends_on:
      redis: { condition: service_healthy }
      identity-service: { condition: service_healthy }

volumes:
  mongo-data:
```

- [ ] **Step 3: Bring the stack up**

```bash
cp .env.example .env    # fill in JWT_SECRET at minimum
docker compose up -d --build
docker compose ps
```
Expected: all nine containers running, health checks passing.

- [ ] **Step 4: Verify every service answers its health probe**

```bash
for p in 3000 3001 3003 3004 3005; do
  echo -n "$p: "; curl -sf "http://localhost:$p/health" || echo FAILED
  echo
done
```
Expected: five JSON responses. `notification-service` has no HTTP API historically — it gains one solely for `/health`.

- [ ] **Step 5: Verify the RabbitMQ topology is durable**

```bash
docker compose exec rabbitmq rabbitmqctl list_queues name durable messages
docker compose exec rabbitmq rabbitmqctl list_exchanges name type durable
```
Expected: named queues (`identity.fetchTeamDetails`, `notification.notification`, `match.TeamDetails`, …) all with `durable=true`, plus `football.events` and `football.events.dlx` as durable exchanges. **Zero queues with generated `amq.gen-*` names** — any of those means a `consumeEvent` call site was ported without its queue-name argument.

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml .env.example .gitignore
git commit -m "feat: docker-compose stack for all five services (D-04)

First reproducible way to run the full system. Health checks gate startup
ordering; durable queue names verifiable via rabbitmqctl."
```

---

### Task 17: End-to-end smoke test

**Files:**
- Create: `scripts/smoke-test.mjs`
- Modify: root `package.json` (add `"smoke": "node scripts/smoke-test.mjs"`)

**Interfaces:**
- Consumes: the running compose stack
- Produces: the migration's only behavioral verification

**Why these assertions:** steps 4, 6, and 9 cross the RabbitMQ boundary. They are the only checks in the entire plan that can detect a broken event handler — `tsc` cannot reach them, and the HTTP responses alone do not reflect them because the denormalized fields are populated *after* the response returns.

- [ ] **Step 1: Create `scripts/smoke-test.mjs`**

```js
/**
 * End-to-end smoke test against the docker-compose stack.
 *
 * Exercises the real business flow through the gateway only — never a service port
 * directly — so it also proves the proxy rewriting and JWT verification work.
 *
 * The eventually-consistent assertions (steps 4, 6, 9) poll rather than sleep: the
 * denormalised fields are written by RabbitMQ consumers after the HTTP response
 * returns, so a fixed sleep is either flaky or needlessly slow.
 */
const GW = process.env.GATEWAY_URL ?? 'http://localhost:3000';
const stamp = Date.now();

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name} ${detail}`);
  }
}

async function poll(name, fn, { attempts = 20, delayMs = 500 } = {}) {
  for (let i = 0; i < attempts; i++) {
    try {
      if (await fn()) {
        check(name, true);
        return true;
      }
    } catch { /* keep polling; the consumer may not have run yet */ }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  check(name, false, `(gave up after ${attempts} attempts)`);
  return false;
}

async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${GW}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

console.log('\n1. Register host team');
const host = {
  teamName: `HostTeam${stamp}`,
  collegeName: 'Host College',
  email: `host${stamp}@example.com`,
  password: 'password123',
};
const hostReg = await api('/v1/auth/register', { method: 'POST', body: host });
check('host registered', hostReg.status === 201, `got ${hostReg.status}`);
check('access token issued', typeof hostReg.json.accesstoken === 'string');

console.log('\n2. Login host team');
const hostLogin = await api('/v1/auth/login', {
  method: 'POST',
  body: { email: host.email, password: host.password },
});
check('host logged in', hostLogin.status === 200, `got ${hostLogin.status}`);
const hostToken = hostLogin.json.accesstoken;
const hostTeamId = hostLogin.json.team;
check('team id returned', Boolean(hostTeamId));

console.log('\n3. Register + login challenger team');
const guest = {
  teamName: `GuestTeam${stamp}`,
  collegeName: 'Guest College',
  email: `guest${stamp}@example.com`,
  password: 'password123',
};
await api('/v1/auth/register', { method: 'POST', body: guest });
const guestLogin = await api('/v1/auth/login', {
  method: 'POST',
  body: { email: guest.email, password: guest.password },
});
check('guest logged in', guestLogin.status === 200, `got ${guestLogin.status}`);
const guestToken = guestLogin.json.accesstoken;

console.log('\n4. Auth is actually enforced at the gateway');
const noAuth = await api('/v1/match/create-match', {
  method: 'POST',
  body: { matchTime: new Date().toISOString(), location: 'Ground A' },
});
check('unauthenticated match creation rejected', noAuth.status === 401,
  `got ${noAuth.status}`);

console.log('\n5. Create a match');
const created = await api('/v1/match/create-match', {
  method: 'POST',
  token: hostToken,
  body: { matchTime: new Date(Date.now() + 86_400_000).toISOString(), location: 'Ground A' },
});
check('match created', created.status === 201, `got ${created.status}`);
const matchId = created.json._id ?? created.json.match?._id;
check('match id returned', Boolean(matchId));

console.log('\n6. CROSSES RABBITMQ: match gets denormalised team details');
// match-service publishes fetchTeamDetails; identity-service answers with TeamDetails;
// match-service writes teamName/collegeName onto the Match. None of this is visible
// in the create response, which returns before the round-trip completes.
await poll('teamName populated by fetchTeamDetails/TeamDetails round-trip', async () => {
  const res = await api('/v1/match/get-my-matches', { token: hostToken });
  const list = Array.isArray(res.json) ? res.json : (res.json.matches ?? []);
  const m = list.find((x) => String(x._id) === String(matchId));
  return Boolean(m?.teamName);
});

console.log('\n7. Send an invite');
const invite = await api(`/v1/match/send-invite/${matchId}`, {
  method: 'POST',
  token: guestToken,
  body: {},
});
check('invite created', invite.status === 201, `got ${invite.status}`);
const inviteId = invite.json._id;
check('invite id returned', Boolean(inviteId));

console.log('\n8. Host accepts the invite');
const accepted = await api(`/v1/match/respond-to-invites/${inviteId}`, {
  method: 'POST',
  token: hostToken,
  body: { response: 'accepted' },
});
check('invite accepted', accepted.status === 200, `got ${accepted.status}`);

console.log('\n9. CROSSES RABBITMQ: match reaches "matched"');
await poll('match status is matched', async () => {
  const res = await api('/v1/match/get-my-matches', { token: hostToken });
  const list = Array.isArray(res.json) ? res.json : (res.json.matches ?? []);
  const m = list.find((x) => String(x._id) === String(matchId));
  return m?.status === 'matched';
});

console.log('\n10. Token refresh works');
const refreshed = await api('/v1/auth/refresh-token', {
  method: 'POST',
  body: { refreshtoken: hostLogin.json.refreshtoken },
});
check('tokens refreshed', refreshed.status === 200, `got ${refreshed.status}`);

console.log(`\n${failures === 0 ? 'SMOKE TEST PASSED' : `SMOKE TEST FAILED (${failures} failures)`}`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 2: Add the script to the root `package.json`**

```json
"smoke": "node scripts/smoke-test.mjs"
```

- [ ] **Step 3: Run it against the live stack**

```bash
docker compose up -d --build
npm run smoke
```
Expected: `SMOKE TEST PASSED`.

If step 6 or 9 fails while everything else passes, the failure is in the event pipeline, not the HTTP layer. Check in this order: `rabbitmqctl list_queues` for `amq.gen-*` names (a missing queue-name argument), then `football.dlq` depth (a handler throwing), then the consuming service's logs.

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke-test.mjs package.json
git commit -m "test: end-to-end smoke test across the RabbitMQ boundary (D-04)

Steps 6 and 9 poll for eventually-consistent state written by event
consumers — the only assertions in the migration that can detect a
broken event handler."
```

---

### Task 18: Final verification and backlog capture

**Files:**
- Modify: `docs/DECISIONS.md` (append the deferred backlog)

- [ ] **Step 1: Run the complete verification suite**

```bash
npm run build -w @uff/shared
npm run typecheck
npm run build
find api-gateway/src identity-service/src match-service/src media-service/src notification-service/src -name '*.js' | wc -l   # expect 0
git ls-files | grep -c '\.log$'                                                                                                # expect 0
docker compose up -d --build
for p in 3000 3001 3003 3004 3005; do curl -sf "http://localhost:$p/health" > /dev/null && echo "$p ok" || echo "$p FAILED"; done
docker compose exec rabbitmq rabbitmqctl list_queues name durable | grep -c 'amq.gen'                                          # expect 0
npm run smoke
```

Every line must pass. Report actual output — do not summarise a partial run as success.

- [ ] **Step 2: Confirm the monolith still works**

```bash
node -e "require('./src/index.js')" 2>&1 | head -5
```
The legacy monolith is CommonJS and depends on the root `package.json` not declaring `"type": "module"` (D-02). This check catches the single most likely way the workspace conversion silently broke it. A connection error is fine; a `ERR_REQUIRE_ESM` or module-resolution error is not.

- [ ] **Step 3: Append the deferred backlog to `docs/DECISIONS.md`**

```markdown
---

# Deferred Backlog

Recorded during the migration, not fixed by it. Ranked by severity.

1. **Auth bypass** — downstream services trust `x-team-id` unconditionally; anyone who can reach a
   service port directly can impersonate any team. Needs a shared secret, signed header, or mTLS.
2. **Dual-path enrichment** — every enrichment exists as both sync HTTP and async event, with
   different payload shapes. The sync invite path omits `purpose`, so `notification-service` hits
   its `default` branch and **invite emails are never sent through it**. `handleInvite` also
   destructures `{hostTeam, acceptedTeam}` from a payload carrying `{sender, receiver}`.
3. **No service discovery** — gateway targets come from env vars; match-service's gateway callback
   URL was hardcoded and is now an env var with the same default.
4. **`Team.role`** (`TEAM | ADMIN`) is never placed in the JWT and never checked anywhere.
5. **JWT `name` claim is always `undefined`** — signed from `team.name`; the model field is `teamName`.
6. **Wide-open CORS** — `app.use(cors())` in every service.
7. **Rate limiting disabled** in three of five services; the config was commented out and has now
   been deleted along with its dependencies.
8. **No tracing or correlation-ID propagation** — `correlationId` is set on one event payload and
   never read. Flows spanning four hops are undebuggable.
9. **No central log store or rotation** now that file transports are removed.
10. **Per-service unit and integration test suites.**
11. **No CI pipeline.**
12. **Password hash leaks onto the event bus and over HTTP** — `handleTeamDetailEvent` publishes the
    full Team document including the argon2 hash, and `GET /getTeamById/:teamId` returns it in the
    response body. Discovered while typing the event contracts.
13. **Inconsistent routing-key naming** — PascalCase, camelCase, and dot.case all in use.
14. **Event handlers swallow their own errors**, so they always ack and the new dead-letter queue is
    unreachable from them. The DLX only catches failures the handlers do not catch themselves.
15. **Legacy monolith `/src`** still on Express 4 with Socket.io chat and admin routes that no
    microservice implements.
```

- [ ] **Step 4: Final commit**

```bash
git add docs/DECISIONS.md
git commit -m "docs: record deferred backlog from the TypeScript migration

Items 12 and 14 were discovered during the port, not present in the
original architecture audit."
```

---

## Verification Summary

| Layer | Command | Catches |
|---|---|---|
| Types | `npm run typecheck` | internal type errors; cross-service event payload mismatches |
| Build | `npm run build` | emit and module-resolution failures |
| No JS left | `find <services>/src -name '*.js'` | files missed by the port |
| Stack boots | `docker compose ps` + `/health` × 5 | wiring, env, startup ordering |
| Bus topology | `rabbitmqctl list_queues \| grep amq.gen` | a `consumeEvent` call site ported without its queue name |
| Behavior | `npm run smoke` | broken controllers, proxies, auth, and event handlers |
| Monolith intact | `node -e "require('./src/index.js')"` | workspace conversion breaking CommonJS (D-02) |

**Not covered, per D-04:** unit-level branch coverage, error paths, and any logic error that still
returns a well-shaped response.
