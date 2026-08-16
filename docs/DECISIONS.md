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

**Measured, not merely reasoned (D-17).** This entry was written as a precaution. It has since been
demonstrated: a full `docker compose down` followed by a `--no-build` restart brought all nine named
durable queues and both exchanges back, restored from `rabbitmq-data`, and the smoke test passed
19/19 against the recreated containers. Without the volume that restart is exactly the case D-05
was supposed to have fixed.

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

## D-16 — `ENRICHMENT_TIMEOUT_MS` (default 2500 ms) replaces the hardcoded 700 ms

**Decision:** `match-service`'s enrichment budget is `env.ENRICHMENT_TIMEOUT_MS`, defaulting to
2500 ms, and it is applied to `respondToInvite`'s per-team lookups as well, which previously had no
timeout at all. Landed in `42f5f17`.

**This is a behaviour change, not a tuning tweak.** It is recorded here, separately from the other
three changes in that commit, because it is the only one that alters which code path production
actually exercises. Every other departure the runtime audits produced either repairs a path that
was already claimed to work or corrects a comment.

**Why:** 700 ms had to cover two chained network hops in each direction — match → gateway →
identity → Mongo and back — twice in parallel, on a stack where those hops share a Docker bridge
with four other services. It had no headroom under load, and it was hardcoded, so the only way to
give it any was to edit and rebuild.

**Consequence:** when the budget blows, `Promise.allSettled` still means the invite is created and
a `notification` is still published, just with `teamId`-only teams and no `teamName`, `email` or
`collegeName`. Raising the budget therefore does not change the failure mode; it changes how often
production is in it. Fewer degraded notification payloads, and a slower worst-case invite response
— and in `respondToInvite`, which is sequential, a worst case of `teams × 2500 ms` rather than the
unbounded hang it replaced. A path that used to be common under load is now rare, which means the
degraded payload is now the kind of bug that shows up in production and not in testing.

**Correction to the framing this was reported under:** the raise was described to this log as making
the synchronous path "fail fast into the async fallback" under the old budget and "win far more
often" under the new one. The first half is not what the code does. `createInvite`'s asynchronous
fallback runs only if `publishEvent` throws; an enrichment failure reaches it through
`Promise.allSettled`, which never rejects, so a blown 700 ms budget never reached the fallback and
never has. The async enrichment path that does run (`fetchTeamDetailsForMatchInviteCreated` →
`TeamDetailsForMatchInvite`) is the other half of the dual-path duplication, running unconditionally
and independently of the timeout — not a fallback the timeout triggers. See A-13, and
`match-service/FLOW.md` issue 6.

**Unverified.** Nothing has been built or run with this change in it. See D-17.

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

## D-17 — What `verified/smoke-19-of-19` certifies, and what sits above it

**Decision:** the tag `verified/smoke-19-of-19` (`7fd2b02`) is the verification boundary of this
repository. Everything at or below it has been exercised. Everything above it has not, and must not
be described as verified in any commit message, report, or handover until it has been rebuilt and
re-smoked.

**Why this needs its own entry:** the repository currently contains verified and unverified work
side by side on the same branch, with nothing in the tree to distinguish them. `HEAD` looks more
finished than it is provable to be. Four of the commits above the tag carry the word `fix` and read
like improvements; none of them has ever been executed.

**What the tag covers.** `7fd2b02` is the tree the passing smoke test ran against, and it is the
tree the currently running images were built from. The suite passed `19/19` **twice**:

1. On first bring-up.
2. Again after a full `docker compose down` and a `--no-build` restart.

The second run is not a repeat of the first. `--no-build` means it ran the same images, so it proves
nothing new about the code — what it proves is about *state*. Container recreation destroyed and
recreated every container, and all nine named durable queues and both exchanges came back from the
`rabbitmq-data` volume. That is the measurement that upgrades D-13 from a reasoned precaution to a
demonstrated one, and it is the only way that volume's necessity could have been shown.

**What sits above the tag, unexercised.** Six commits. Two are documentation-only (`ba43e99`,
`6c97b98`). The other four touch `src/`:

| Commit | Service | Reaches runtime? |
|---|---|---|
| `4f7531e` | media | yes — `cloudinary.ts`, `server.ts` |
| `178c69e` | notification | yes — `env.ts`, `mailer.ts` |
| `405ff63` | api-gateway | no — the `src/server.ts` diff is comments only |
| `42f5f17` | match | yes — `server.ts`, `env.ts`, controller, event handler (D-16) |

All four typecheck clean under `strict`. **That is the entire extent of the evidence.** No image has
been built from any of them, no container has run one, and the smoke test has not been executed
against them. Typecheck-clean is the weakest of the three D-04 layers and is specifically the layer
that cannot see the things these commits change: a shutdown drain, a mailer that must now boot
without credentials, and a timeout that only matters under load.

**Named acceptance criterion for the next rebuild** (from the match-service audit, because the
shutdown drain is the change that can only prove itself against a real SIGTERM with a real in-flight
request): the first `docker compose stop` after the rebuild must show **`Shutdown complete`** in
`match-service`'s logs. If it instead shows **`Shutdown exceeded 8000ms, forcing exit`**, then
`server.closeIdleConnections()` did not do its job and the drain fix is not working — the forced-exit
timer fired, which is the failure path, not the success path. Do not read the clean container exit as
success on its own; the forced exit also produces one.

**Consequence:** the tag must be moved only by a run that reproduces the evidence above, and moving
it is the act that makes the four commits verified. Until then, `git log verified/smoke-19-of-19..HEAD`
is the authoritative list of what is unproven.

### SUPERSEDED — the boundary has moved twice since this entry was written

This entry's *rule* stands unchanged; only the tag it names is stale. Recorded rather than edited,
because the rule was written before either move and its authority comes from having predicted them.

1. **`verified/smoke-19-of-19` → `5e19435`.** The four commits above were rebuilt and re-smoked:
   19/19, and the shutdown criterion passed — `Shutdown complete` in match-service's log in
   **0.19 s**, not the forced-exit path. `closeIdleConnections()` did its job, with the gateway
   holding live keep-alive sockets from a completed smoke run.
2. **`verified/smoke-21-of-21` → `add9416`** is now the boundary (see D-19). Two assertions were
   added, so the suite name changed with it.

Read the rule as: *the newest `verified/smoke-*` tag is the boundary, and
`git log <that tag>..HEAD` is the authoritative list of what is unproven.* At the time of writing
that range is empty.

---

# Post-audit fixes

## D-19 — Invite emails: fixed in the order A-13 mandates, and delivery made provable

**Decision:** executed step 1 of A-13 — reconcile the consumer, then make the sync path reachable —
and added a local SMTP sink so that "an email was sent" became an assertion rather than a claim.

**Why now:** it was the user's explicit request, and A-13 already contained the safe ordering.

**The three stacked defects.** None alone explains the symptom; each hid the next.

1. `notification-service`'s `handleInvite` destructured `{ hostTeam, acceptedTeam }` from a payload
   carrying `{ sender, receiver }`. Both were `undefined` on every invite, so the send threw.
2. `createInvite` published without `purpose`, so `notification-service`'s `switch` dropped the
   event on its `default:` branch and the handler above was never reached at all.
3. `sendMail`'s delivery-audit write could not satisfy the schema — `recipientTeamId` and `type` are
   required and no caller supplied them — so `Notification.create()` rejected *after* the mail had
   already gone out. Every successful send was reported as a failure.

**Order was load-bearing, exactly as A-13 predicted.** Fixing (2) first — the one-line change, the
obvious one — would have made a cold path hot and crashed it on `hostTeam.email` for every invite.
The consumer was fixed first; only then was `purpose: 'invite'` uncommented.

**Role mapping**, taken from the template's own wording rather than the variable names:
`receiver` → the team hosting the match, and the recipient; `sender` → the challenger, named in the
body. The old names had it inverted relative to the payload, which is why nothing lined up.

**Defect 3 had a second victim, and it was measured.** The runtime audit recorded that a
`match.fixed` event owing two emails produced exactly one send — the rejected audit write aborted
the rest. With the write made conditional and isolated in its own try/catch, both now arrive.
Bookkeeping must not be able to un-send an email. The `notifications` collection, empty in
production since it was created, now holds real rows.

**Verification — the part that matters.** `docker-compose.yml` gained a Mailpit SMTP sink and the
mailer gained an `SMTP_HOST` override; the Gmail transport is unchanged when it is unset. Before
this, notification-service's only purpose was unverifiable on any machine without a Google app
password, which is a large part of why these defects survived a full port and an audit.

The smoke test asserts two things, and the second is the one with teeth: the email is **delivered**,
and its body **names the challenging team**. A swapped mapping still delivers an email — delivery
alone is not evidence of correctness. 21/21; tag `verified/smoke-21-of-21` at `add9416`.

**What was deliberately NOT fixed:** step 2 of A-13. The asynchronous fallback remains unreachable,
and it still publishes a third payload shape carrying only the receiver's details with no sender at
all, so it cannot name the challenger even if reached. Making it reachable now would surface that
third shape. A-13 stays open on its second half; see the status note there.

---

# Deferred backlog

## D-18 — The backlog is the audited ranking, under its own ID space

**Decision:** the backlog below replaces the one written before anything ran. It is ranked by the
four runtime audits, carries an owner per item, and is numbered `A-1` … `A-13` — a new ID space,
not a renumbering of the old one.

**Why the backlog lives here now:** it never did. The implementation plan's Task 18 Step 3 specified
appending a fifteen-item list to this file, and that step was never executed. The list exists only
as a *proposed* markdown block inside
`docs/superpowers/plans/2026-08-16-typescript-migration.md`, and an earlier eleven-item version sits
in §8 of the design spec. So this section is an addition, not an edit — which also means nobody has
ever been reading the backlog from the place the code's comments point at.

**Why a new ID space rather than reusing 1–15:** twenty-nine comments across the five services and
`packages/shared` cite `backlog item N`. Renumbering would silently re-point every one of them —
the comments would still parse, still read sensibly, and mean something else. Worse, those citations
already do not agree on which list they mean: `notification-service/src/utils/mailer.ts:36` cites
"backlog item 9" for the missing SMTP retry, but item 9 in the plan's list is log rotation;
`identity-service/src/server.ts:114` cites "Backlog item 12 **in the architecture docs**", which is
a third numbering space entirely (`docs/architecture/0N-*.md` each carry their own issue table).
There are at least three live numbering spaces and the code's citations are split across them. A
distinct prefix is the only change that cannot make that worse.

**Consequence:** `backlog item N` in a source comment refers to the old plan list, whose numbers are
frozen and no longer maintained. `A-N` refers to this list. Anything touching those comments should
convert them, one file at a time, rather than in a sweep — a sweep would have to guess which of the
three spaces each citation meant, and several of them are already wrong.

---

### The audited backlog

Ranked by severity, from the four runtime audits against the live stack. Owner in brackets.

**A-1 — HIGH — The argon2 password hash is exposed unauthenticated on the public port.**
[identity + gateway]
`GET /v1/auth/getTeamById/:id` returns the full Team document, hash included, on published port
3000 with **no authentication** — not merely inside the compose network. The gateway does not apply
`validateToken` to `/v1/auth`, deliberately and correctly, because that is where tokens are issued
and requiring one would make login unreachable; the side effect is that every route under that
prefix is public. Confirmed by curl from the host: an unauthenticated
`GET /v1/auth/getTeamById/<id>` reaches identity-service and answers `404` (team not found), while
`GET /v1/match/...` answers `401`. The same document also travels the bus — `handleTeamDetailEvent`
publishes it whole as `TeamDetails` — and consumers log the payload verbatim, so the hash lands in
match-service's stdout as well. Three exposures, one root cause: identity-service has no projection.
Fix it there. Redacting the consumer's log line leaves the hash on the bus and at the public edge.

**A-2 — HIGH — There is no RabbitMQ reconnect, and `/health` cannot see that.** [packages/shared]
`connection.on('close')` logs a warning and does nothing else. The module-level `channel` stays
non-null, so `requireChannel()` keeps handing out a dead channel: publishes throw, consumers are
gone, and both stay that way for the lifetime of the process. Every service's `/health` reads only
`mongoose.connection.readyState`, so the container reports `healthy` while every event path is mute
— and because the process never exits, `restart: unless-stopped` never fires either. Nothing in the
system can currently observe this state. Argues for two changes together: a reconnect path, and a
readiness/liveness split so that "Mongo is up" stops being allowed to stand in for "this service can
do its job".

**A-3 — HIGH — `trust proxy` is set with nothing in front of the gateway.** [gateway]
`app.set('trust proxy', 1)` with no proxy, load balancer, or ingress ahead of it means `req.ip` is
whatever the client puts in `X-Forwarded-For`. Any client can mint itself a fresh rate-limit bucket,
and rotating the header bypasses the limiter entirely. Verified live: a request carrying
`X-Forwarded-For: 203.0.113.99` created the Redis key `rl:203.0.113.99`. This is the **only active
limiter in the system** — the other four services' limiters are commented out — so it is not one
defence among several. Note this was originally filed as a middleware-ordering nit; the ordering is
in fact harmless, and the real defect is worse than the one that was filed.

**A-4 — HIGH — match-service's enrichment spends the public rate-limit budget.** [gateway + match]
`match-service` calls `GET /v1/auth/getTeamById/:id` at three sites through `GATEWAY_URL`, so its
inward enrichment re-enters the public edge and shares the same 100-per-15-minutes bucket as real
clients. Visible in Redis as the `rl:172.19.0.7` counter. Roughly 50 invite operations exhaust it
cluster-wide; identity then returns 429, `Promise.allSettled` swallows it, and the notification is
published with `teamId`-only teams. The system degrades notification quality under load, silently,
and the degradation gets worse exactly when traffic is highest. D-16 makes this rarer; it does not
address it.

**A-5 — MED — Shutdown does not drain in-flight messages, and D-05 changed what that costs.**
[shared + notification]
`closeRabbitMQ()` closes the channel without waiting for in-flight handlers, so unacked messages are
requeued. Recorded honestly: **D-05's durable queues converted silent message LOSS into silent
message DUPLICATION on redeploy.** Before D-05 a severed channel lost the message; now it is
redelivered, and there is no idempotency key anywhere, so `notification-service` sends the email
twice. That is a better failure mode than losing it, and it is still a defect — and it was not
flagged when D-05 was proposed. D-05's recorded consequences covered backlog accumulation and disk
usage, not redelivery. Fixing this needs both halves: drain before closing, and a dedupe key so a
redelivery that does happen is harmless.

**A-6 — MED — SMTP is synchronous in the handler, with no retry and no backoff.** [notification]
The send happens inline inside the event handler. A failure is logged, the message is acked, and it
is gone — no retry, no backoff, no bounce handling, and no dead-lettering either, because the
handler catches its own error and so the shared client never sees a throw (see the retirement of old
item 14, below). A Gmail outage therefore discards every notification raised during it, silently and
permanently. The natural fix — an outbound queue with retry — is the
same work as A-5's idempotency key and should be scoped with it.

**A-7 — MED — Cloudinary is called before the Mongo write, so failures orphan assets.** [media]
`uploadMediaToCloudinary()` runs at `media-controller.ts:44` and `newlyCreatedMedia.save()` at line
63. A `save()` failure — validation, a Mongo blip, a duplicate key — leaves an uploaded asset in
Cloudinary that no record points at and no code path ever deletes. It accumulates, it costs money,
and nothing in the system can enumerate the orphans after the fact. Either reverse the order or
delete on the failure path.

**A-8 — MED — `publishEvent` is fire-and-forget on a non-confirm channel.** [shared + media]
The channel comes from `createChannel()`, not `createConfirmChannel()`, and `ch.publish()`'s return
value is discarded. `publishEvent` is declared `async` but awaits nothing, so awaiting it proves
only that the bytes were handed to the socket buffer. A `201` response is therefore not evidence
that the event was delivered — it is evidence that the write did not throw synchronously. Every
"created and notified" flow in the system rests on this.

**A-9 — MED — The gateway's `/health` returns 503 on Redis loss, although routing still works.**
[gateway]
Redis backs the rate-limit counters and nothing else; the gateway owns no data and the proxies are
stateless, so losing Redis degrades rate limiting and leaves routing entirely intact. Reporting 503
means anything gating on `service_healthy` — compose `depends_on`, an orchestrator, a load balancer
— pulls a working gateway out of rotation over a subsystem that does not affect its ability to serve.
The same readiness/liveness split A-2 needs would resolve this too, from the opposite direction.

**A-10 — MED — No forced-exit timer and no `stop_grace_period`.** [all]
`server.close()` stops accepting new connections but does **not** close idle keep-alive connections,
so a shutdown can sit waiting on a socket that will never send another request. With no
`stop_grace_period` in `docker-compose.yml`, Docker's 10-second default applies and then SIGKILL
lands — potentially mid-flight through a large buffered response. `match-service` alone now has the
fix (`closeIdleConnections()` under an 8-second deadline, `42f5f17`, unverified per D-17); the other
four do not. Whatever `match-service` proves at the next rebuild is the pattern to copy.

**A-11 — MED — The media upload path has never been exercised, anywhere.** [media + test]
`.env` carries placeholder Cloudinary credentials (D-14), and `scripts/smoke-test.mjs:184` records
explicitly that upload is not covered because it needs real ones. So `media-service`'s only write
path and only event publish have never succeeded in any environment — not in CI, not locally, not
in the smoke run behind the tag. Every claim about that path is a claim about code that has been
read and typechecked, and nothing more. Note the interaction: this is also the one path A-7 and A-8
both live on.

**A-12 — LOW — `/health` logging buries everything else.** [all]
The request logger runs before `/health` and does not skip it. At the compose health-check's 10-second
interval that is roughly 17k lines per service per day of pure noise, which is what makes a real
event hard to find at the moment someone needs to find one. Skip `/health` in the request logger, or
drop it to `debug`.

**A-13 — MED — Dual-path enrichment: fix the consumer payload FIRST, then the reachability.**
[match + notification]

**This is one item with a mandatory internal order. It is not two tickets. Do not split it, and do
not take the second half alone because it looks like a one-line change — it is the half that breaks
production.**

The situation: `createInvite`'s asynchronous fallback is unreachable in practice. It runs only if
`publishEvent` throws, and the enrichment failure it was written to catch arrives via
`Promise.allSettled`, which never rejects. So an enrichment failure never takes the fallback; it
silently publishes a `notification` carrying `teamId`-only teams. That is the silent degradation
A-4 and D-16 both describe.

Making the fallback reachable is a small change. It is also the wrong first move, because the
fallback publishes a team projection that `notification-service` throws on:
`handleInvite` destructures `hostTeam` and `acceptedTeam` from a payload that carries `sender` and
`receiver`, so `hostTeam` is always `undefined` and `inviteTemplate(hostTeam, acceptedTeam)` throws
on `hostTeam.teamName`. That path is currently cold, which is the only reason it is not visible.

Therefore, in this order:

1. **Fix the consumer.** Reconcile `notification-service`'s `handleInvite` with the payload
   match-service actually publishes — including the commented-out `purpose: 'invite'`, whose absence
   sends the sync path to the `default` branch. The consumer must be able to survive the fallback's
   payload before anything starts sending it one.
2. **Then make the fallback reachable.** Have enrichment failure actually reach the catch, rather
   than being absorbed by `allSettled`.

Doing 2 before 1 takes a silent degradation — a notification with missing team names — and converts
it into a downstream crash on a path that currently never runs. That is **strictly worse than the
bug being fixed**, and it would be caused by the fix, which makes it the kind of regression that is
hard to attribute. Step 1 alone is safe and improves nothing observable; step 2 alone is unsafe.
Only 1-then-2 is correct.

> **STATUS — step 1 DONE (`add9416`, D-19). Step 2 still open.**
>
> The consumer now reads `{ sender, receiver }`, `purpose: 'invite'` is uncommented, and invite
> emails are delivered and asserted end to end (21/21). One correction to the analysis above, which
> was right about the ordering and wrong about one detail: `handleInvite` threw on
> `hostTeam.email`, not on `hostTeam.teamName` — the template call was reached with `undefined`
> arguments and the destructured read failed first. Immaterial to the conclusion.
>
> **Step 2 has grown a third blocker.** The fallback publishes neither the sync shape nor the
> match-fixed shape: it forwards the `TeamDetailsForMatchInvite` projection — receiver details only,
> **no sender at all** — plus a `purpose`. So even a reachable, non-crashing fallback cannot name
> the challenging team, and the email it produced would be strictly worse than the sync one. Step 2
> now requires carrying `senderTeamId` through `fetchTeamDetailsForMatchInviteCreated`, which is a
> change to the shared event contract and to identity-service's handler — not a match-service
> change. Re-scope before picking it up.

---

### Carried forward from the pre-runtime backlog

These are not superseded — the audits simply did not revisit them, because they are design gaps
rather than runtime behaviour. They keep their **original numbers** so that the `backlog item N`
comments in the source, and D-12's reference to "backlog item 1", still resolve. Read them against
the plan's list, not against `A-N`.

| Old # | Item | Still open |
|---|---|---|
| 1 | Downstream services trust `x-team-id` unconditionally | yes — bounded only by D-12 not publishing their ports |
| 2 | Dual-path enrichment, divergent payload shapes | yes — the actionable part is now **A-13** |
| 3 | No service discovery; gateway targets are env vars | yes |
| 4 | `Team.role` never enters the JWT and is never checked | yes |
| 5 | JWT `name` claim always `undefined` (model field is `teamName`) | yes |
| 6 | Wide-open CORS in every service | yes |
| 7 | Rate limiting disabled in four of five services | yes — and it is why **A-3** has no backstop |
| 8 | No tracing or correlation-ID propagation | yes |
| 9 | No central log store or rotation | yes — compounded by **A-12** |
| 10 | No per-service unit or integration suites | yes — the accepted cost of D-04 |
| 11 | No CI pipeline | yes |
| 13 | Inconsistent routing-key naming (Pascal, camel, dot.case) | yes |
| 15 | Legacy monolith `/src` on Express 4, unported | yes — deliberate, D-02 |

**Old item 12 and old item 14 are retired**, and neither was accurate as written:

- **Old 12** said the argon2 hash leaks onto the event bus and over HTTP. Both true, but it
  understated the exposure: it is served **unauthenticated on the published public port**, which is
  the fact that sets the severity. Restated as **A-1**.
- **Old 14** said the dead-letter queue is unreachable because handlers swallow their own errors.
  Too absolute, and wrong as stated. In `packages/shared/src/rabbitmq.ts` the `JSON.parse` runs
  *inside* the try and *before* `await handler(payload)`, so a malformed message body does throw
  there and does `nack(msg, false, false)` to the DLX. The accurate statement: **handler-thrown
  errors never reach the DLQ**, because each handler's own try/catch swallows them before the shared
  client can see them — **malformed JSON does reach it.** So `football.dlq` is a working poison-message
  path and a non-existent handler-failure path, and reading "0 messages" on it means only that
  nothing malformed has arrived. It is not evidence that no handler has failed. This is what makes
  A-6's silent discard invisible.
