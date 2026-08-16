# notification-service — Execution Flow

How execution actually travels through this service. Companion to
`docs/architecture/05-notification-service.md`, which describes the service from the outside; this
describes it from the inside.

This service is a **pure event consumer**. One queue, one routing key, one dispatch switch, three
email templates. It has no API, no router, and no controller — the Express app exists only to serve
a health probe.

---

## ⚠️ Read this first — the invite path does not work, and the port kept it that way

Two independent defects sit on top of each other, and between them **no invite email has ever been
delivered by this service**. Both are preserved deliberately under D-05 and backlog item 2. Do not
"fix" either one in isolation; they belong to the dual-path enrichment redesign, which is out of
scope for the migration.

**Defect A — the payload keys never matched.** `handleInvite` destructures
`{ hostTeam, acceptedTeam }`. What match-service actually publishes on `purpose: 'invite'` is
`{ inviteId, matchId, sender, receiver, status, note, createdAt, correlationId }` — the contract in
`@uff/shared/events` as `InviteNotification`. There is no `hostTeam` and no `acceptedTeam` on it,
and there never has been. Both locals are `undefined` on every invite.

The first thing that touches them is `inviteTemplate(hostTeam, acceptedTeam)`, which reads
`hostTeam.teamName`. So the throw is a `TypeError` raised **inside the template**, before
`hostTeam.email` is evaluated and before `mailer.sendMail` is reached — no SMTP call is even
attempted. `handleInvite`'s own `catch` logs `Error in sending mail for invite` and returns
normally, so the message is acked and gone.

In TypeScript this cannot be written directly — `hostTeam` is not on `InviteNotification` — so
`notificationService.ts` declares a local `InviteEventAsRead` interface and casts to it. The cast
*is* the divergence, made explicit and greppable rather than hidden.

**Defect B — most invites never reach `handleInvite` at all.** match-service's *synchronous* invite
path publishes the notification with the `purpose` field commented out at the call site. `purpose`
is therefore `undefined`, the dispatch switch falls through to `default`, and the event is logged
as `Unknown notification purpose: undefined`. Only the *asynchronous* fallback path — reached when
sync enrichment throws — sets `purpose: 'invite'`, and that path then lands on defect A.

This is why `purpose` is declared **optional** on `InviteNotification` and required on
`MatchFixedNotification`: `case 'invite'` narrows correctly, and `default` is the branch that
catches the real production traffic. The `default -> logger.warn` branch is load-bearing, not
padding.

**Net effect:** `match.fixed` is the only notification flow that sends anything.

---

## Startup order (`src/server.ts`)

`env.ts` loads and validates the environment **at import time** — a missing variable throws there,
before anything connects. That is why `import { env } from './env.js'` is the first line of
`server.ts`. It now also validates `EMAIL_USER` and `EMAIL_APP_PASSWORD`, which previously surfaced
as an SMTP authentication failure on the first outbound email rather than at boot.

1. `createLogger('notification-service')`
2. Express middleware, in order: `helmet` → `cors` → `express.json` → request logger
3. `GET /health` registered — reports `mongoose.connection.readyState`
4. `createAuthenticateRequest(logger)` mounted globally, **after** `/health` (D-NT-02). It guards no
   routes; its only effect is that unknown paths answer 401 instead of 404, and `/health` is
   registered ahead of it so the container probe is not blocked
5. `createErrorHandler(logger)` registered **last**
6. Redis client constructed. **Nothing in this service reads Redis** — it existed only to back a
   rate limiter that was never applied to a route, and that limiter is gone (D-NT-03)
7. `startServer()`: Mongo connect → RabbitMQ connect → `createMailer()` → `createNotificationService()`
   → one consumer registered → **then** `app.listen`
8. `SIGTERM`/`SIGINT` → `shutdown()`: stop accepting → close RabbitMQ → close Mongo → disconnect Redis

The listener starts last on purpose: the health probe must not report ready before the queue
subscription exists. In the original the Mongo connection was a floating `.then()` at module scope,
so the consumer could start handling events before the database was reachable (D-NT-05).

`createMailer()` fires `transporter.verify()` as a fire-and-forget check. Its result gates nothing —
a failed verification logs `❌ Email transporter verification failed` and the service starts and
sends anyway.

## HTTP paths

| Method | Path | Handler | Auth | Notes |
|---|---|---|---|---|
| `GET` | `/health` | inline in `server.ts` | none | **New in the port.** 200 when `mongoose.connection.readyState === 1`, else 503 |
| any | anything else | — | `authenticateRequest` | 401 without `x-team-id`; there is nothing behind it to reach |

That is the complete HTTP surface. The service is not registered in the api-gateway, so nothing
routes to it from outside the cluster.

## Event paths

| Queue | Routing key | Dispatch | Handler |
|---|---|---|---|
| `notification.notification` | `notification` | `event.purpose === 'invite'` | `handleInvite` — **throws on every call, see above** |
| `notification.notification` | `notification` | `event.purpose === 'match.fixed'` | `handleMatchFixed` |
| `notification.notification` | `notification` | anything else, including `undefined` | `logger.warn('Unknown notification purpose:', ...)` — **the branch real invite traffic lands on** |

This service publishes nothing. It is a leaf.

### `handleMatchFixed` — the only working path

Reads `{ hostTeam, acceptedTeam, rejectedTeams }` off `MatchFixedNotification` and sends, in order:

1. `"Match Fixed!"` → `hostTeam.email`, body `matchFixedTemplate(hostTeam, acceptedTeam)`
2. `"Match Fixed!"` → `acceptedTeam.email`, body `matchFixedTemplate(acceptedTeam, hostTeam)`
3. `"Match Invite Rejected"` → each `rejectedTeams[i].email`, body `rejectTemplate(team, hostTeam)`

Step 3 is a sequential `for` loop with `await` — slow with many invites, and one failure aborts the
remainder. Backlog item 10.

`hostTeam` and `acceptedTeam` are **optional** on the contract: identity-service's batch enrichment
returns an entry carrying `error: 'Not found'` instead of the team fields when a lookup fails, and
match-service may not produce an entry for a role at all. The original code did not guard, so a
missing team throws a `TypeError` on `hostTeam.email` and the `catch` cancels every remaining email.
The port reproduces this with non-null assertions rather than adding a guard — a guard would change
the behaviour from "throws and logs" to "silently skips", which is a different bug, not a fix.
Backlog item 2.

### `sendMail` fails *after* sending — and that cancels the emails behind it

`utils/mailer.ts` does two things per call, in this order: send the mail, then write a
`Notification` audit row. **The second one can never succeed.** The payload omits
`recipientTeamId` and `type` (both `required` on the schema) and adds `metadata` and a top-level
`status` (neither is a schema path, so Mongoose's default `strict` mode silently drops them). Every
`Notification.create()` rejects with a `ValidationError`. Architecture-doc issue #1; the
`notifications` collection is empty and stays empty.

What the architecture doc does not spell out, and what matters when reading `handleMatchFixed`:

```
sendMail()
  ├─ transporter.sendMail()   ✅ the email IS delivered
  ├─ console.log('📧 Email sent: …')
  ├─ Notification.create(…)   ❌ ValidationError  ──┐
  └─ catch (error)  ←──────────────────────────────┘
       ├─ console.error('❌ Error sending email: …')   ← misleading: the email was sent
       ├─ Notification.create(…)   ❌ ValidationError again
       └─ (rejects — `return false` is unreachable)
```

So `sendMail` **rejects on the success path**. In `handleMatchFixed` that means email 1 goes out,
`sendMail` rejects, the handler's `catch` fires, and emails 2 through N are never attempted. A
"match fixed" event delivers exactly one email — to the host — and logs an error claiming the send
failed.

This is derived by reading the control flow; it has not been observed against a live SMTP server.
It is preserved under D-NT-06.

### Errors never reach the dead-letter queue

Both handlers, and the dispatch switch wrapping them, catch their own errors and return normally.
`@uff/shared/rabbitmq` only `nack`s — and therefore only dead-letters — when the handler *throws*.
So the `football.dlq` that D-05 introduced is **unreachable from this service**: a failed send is
acked and gone, exactly as before the port. Same situation as identity-service; backlog item 12.
Removing those internal `try`/`catch` blocks is what would activate the DLQ, and that is a
behaviour change the migration did not make.

## What the port changed

- `rabbitmq.js`, `logger.js`, `errorHandler.js`, `authMiddleware.js` → `@uff/shared`. Behaviour
  changed only for the bus, per D-05.
- The anonymous exclusive queue became the named durable queue `notification.notification`. This is
  the most consequential change in the service: events published while it is down are no longer
  lost, and **two replicas no longer each send every email** — the service is horizontally scalable
  now and was not before.
- The handler is awaited before the ack, and a throwing handler dead-letters. Neither is currently
  reachable, because both handlers catch internally (above).
- `GET /health` added — the service previously exposed nothing at all.
- `SIGTERM`/`SIGINT` graceful shutdown added; `uncaughtException` handler added.
- Mongo connection is now awaited before the consumer registers (D-NT-05).
- ~100 lines of commented-out rate-limiter config removed, along with `express-rate-limit`,
  `rate-limit-redis`, `rate-limiter-flexible`, and `redis` (D-NT-03).
- `axios` and `express-http-proxy` dropped — never imported (D-NT-10). `winston`, `amqplib`, and
  `jsonwebtoken` dropped — now reached via `@uff/shared`, or never used (D-NT-11).
- `mongoose` **declared** for the first time; it was a phantom dependency resolving via hoisting
  (D-NT-01).
- Mailer and notification handlers became factories taking their dependencies (D-NT-04).
- A `Dockerfile` exists for the first time (D-NT-09).
- The listen log reports the port actually bound instead of `3004` (D-NT-12).
- `new Redis(env.REDIS_URL)` replaces the inert `new Redis({ url })` (D-NT-13).
- Two false log lines removed (D-NT-14).

## What the port did NOT change

- **The invite path is still broken end to end**, in both of the ways described at the top of this
  document. Backlog item 2.
- `sendMail` still rejects after a successful send, and still cancels the emails behind it.
  Backlog item 1 of the architecture doc's issue table; D-NT-06.
- The `notifications` collection is still never written. There is still no delivery audit trail.
- No idempotency key on notifications — a redelivered event re-sends the email. This gets *more*
  likely with durable queues, not less. Backlog item 8.
- Rejection emails still go out sequentially in an `await` loop. Backlog item 10.
- Templates still interpolate team-supplied strings into HTML unescaped. Backlog item 11 / D-NT-08.
- Gmail SMTP with a personal app password is still the only transport — ~500 msg/day, no bounce
  handling, no provider abstraction. Backlog item 9.
- The mailer still logs to `console`, not to the winston logger. D-NT-07.
- No retry or backoff anywhere; a transient SMTP failure is logged and dropped.
- `Notification.read` and `delivery.channel: 'in-app'` still describe an in-app inbox with no
  endpoint to read it.
- The request logger still logs `` `Request Body ${req.body}` ``, which has always printed
  `[object Object]`, and still misspells "Received".
- `app.use(authenticateRequest)` still guards nothing. D-NT-02.
- Wide-open CORS. Backlog item 6.
