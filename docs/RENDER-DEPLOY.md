# Deploying to Render

Five services, all on the free tier as Web Services. `render.yaml` is the blueprint;
this document is the part the blueprint cannot express.

Validate the blueprint against Render's current Blueprint reference before your first
deploy — their schema changes, and this was written against the docs at authoring time.

---

## 1. What you need before deploying

Render has no managed MongoDB and no managed RabbitMQ, so two dependencies live
elsewhere. Both have free tiers that fit this project.

| Dependency | Where | Free tier notes |
|---|---|---|
| MongoDB | **MongoDB Atlas** M0 | 512 MB. Allow access from `0.0.0.0/0` — Render free services have no static outbound IP. |
| RabbitMQ | **CloudAMQP** "Little Lemur" | Check the current connection cap; this stack opens one connection per service (4 consumers/publishers). |
| Redis | **Render Key Value**, or Upstash | Only the gateway actually reads it (rate limiting). The other services construct a client and never use it. |

Each service uses a **separate Mongo database name** on the same cluster —
`uff-identity`, `uff-media`, `uff-match`, `uff-notification` — matching compose.

---

## 2. Deploy order

1. Create the Atlas, CloudAMQP and Redis instances; collect their connection strings.
2. Push this repo to GitHub and point a Render Blueprint at `render.yaml`.
3. First deploy will start all five. The gateway will fail its health check — expected:
   it has no service URLs yet.
4. Once the other four have public URLs, set these three on **uff-api-gateway** and
   redeploy it:
   ```
   IDENTITY_SERVICE_URL = https://uff-identity-service.onrender.com
   MEDIA_SERVICE_URL    = https://uff-media-service.onrender.com
   MATCH_SERVICE_URL    = https://uff-match-service.onrender.com
   ```
   The `https://` prefix is required. Render's `fromService` cannot add a scheme, which
   is why these are `sync: false` rather than wired automatically.
5. Fill in the `sync: false` values on each service: Mongo, Redis, RabbitMQ, Cloudinary,
   Gmail.

`JWT_SECRET` and `INTERNAL_SECRET` are generated once on the gateway and referenced by
the others through `fromService`. Do not set them by hand — if they drift, every login
fails and every downstream call 401s.

---

## 2b. Per-service reference: order, commands, env vars

Extracted from each service's `src/env.ts`, not from memory. "Required" means the service
throws at import and crash-loops without it.

### Deploy order, and why

There is a **circular dependency** between `api-gateway` and `match-service`: the gateway
requires match's URL to boot, and match calls back through the gateway for enrichment.
It resolves because `GATEWAY_URL` is *optional* on match (it has a default) while the
three service URLs are *required* on the gateway. So match can start without knowing the
gateway, and you fill that in afterwards.

| # | Deploy | Why here |
|---|---|---|
| 0 | MongoDB Atlas, CloudAMQP, Redis | Everything else needs their connection strings |
| 1 | `identity-service`, `media-service`, `notification-service` | Depend only on infrastructure. Any order; they can go up together. |
| 2 | `match-service` | Infrastructure only. Boots without `GATEWAY_URL`. |
| 3 | `api-gateway` | **Requires** the three service URLs from steps 1–2, so it cannot boot earlier |
| 4 | Set `GATEWAY_URL` on `match-service`, redeploy it | Closes the circle |

Deploying the gateway before step 3 is the most common way to get a confusing
crash-loop: it is not broken, it simply has no URLs yet.

### Build and start commands (Node runtime only)

**If you use the Blueprint (`render.yaml`), skip this — Docker uses each Dockerfile's
`CMD` and Render never asks.** These are only for manually-created Node services.

| Field | Value |
|---|---|
| Build Command | `npm install && npm run build -w @uff/shared && npm run build -w <service>` |
| Start Command | `node <service>/dist/server.js` |

Substituting the gateway: build `... && npm run build -w api-gateway`, start
`node api-gateway/dist/server.js`.

Two things that go wrong here:

- **`npm run build -w @uff/shared` is not optional.** Every service imports the shared
  package from `dist/`. Omit it and the build succeeds, then the service dies at startup
  on a missing module.
- **Never accept Render's auto-detected start command.** It reads `main` from the root
  `package.json`, which is `src/index.js` — the legacy Express 4 monolith, deliberately
  excluded from the migration (D-02). It is not any of these five services.

### Do NOT set `PORT`

Render assigns it and every service reads `process.env.PORT`. Setting it by hand makes
the service bind a port Render is not routing to, and the health check fails forever.

### Environment variables per service

Shared values that must be **identical everywhere they appear**:

- `INTERNAL_SECRET` — all five. Generate once: `openssl rand -hex 32`. If it drifts,
  every downstream call 401s.
- `JWT_SECRET` — gateway and identity only. Identity signs, the gateway verifies. If it
  drifts, every authenticated request 403s.

---

**identity-service**

| Var | Required | Value |
|---|---|---|
| `MONGODB_URL` | ✅ | `mongodb+srv://…/uff-identity` |
| `REDIS_URL` | ✅ | Redis connection string |
| `RABBITMQ_URL` | ✅ | CloudAMQP `amqps://…` |
| `JWT_SECRET` | ✅ | same as gateway |
| `INTERNAL_SECRET` | — | set it; shared across all five |
| `NODE_ENV` | — | `production` |

**media-service**

| Var | Required | Value |
|---|---|---|
| `MONGODB_URL` | ✅ | `mongodb+srv://…/uff-media` |
| `REDIS_URL` | ✅ | |
| `RABBITMQ_URL` | ✅ | |
| `CLOUD_NAME` | ✅ | Cloudinary — note the name, **not** `CLOUDINARY_CLOUD_NAME` |
| `CLOUDINARY_API_KEY` | ✅ | |
| `CLOUDINARY_API_SECRET` | ✅ | |
| `INTERNAL_SECRET` | — | shared |
| `NODE_ENV` | — | `production` |

**notification-service**

| Var | Required | Value |
|---|---|---|
| `MONGODB_URL` | ✅ | `mongodb+srv://…/uff-notification` |
| `REDIS_URL` | ✅ | |
| `RABBITMQ_URL` | ✅ | |
| `EMAIL_USER` | — | Gmail address. Optional, but no email is sent without it. |
| `EMAIL_APP_PASSWORD` | — | Google App Password (needs 2FA), not the account password |
| `SMTP_HOST` | — | **leave EMPTY.** Any value routes mail to a Mailpit that is not deployed. |
| `INTERNAL_SECRET` | — | shared |
| `NODE_ENV` | — | `production` |

**match-service**

| Var | Required | Value |
|---|---|---|
| `MONGODB_URL` | ✅ | `mongodb+srv://…/uff-match` |
| `REDIS_URL` | ✅ | |
| `RABBITMQ_URL` | ✅ | |
| `GATEWAY_URL` | — | **set in step 4** to `https://<gateway>.onrender.com`. The default is `http://localhost:3000`, which on Render silently fails every enrichment. |
| `ENRICHMENT_TIMEOUT_MS` | — | `60000` on free tier. Default 2500 expires during a cold start. |
| `INTERNAL_SECRET` | — | shared |
| `NODE_ENV` | — | `production` |

**api-gateway** — deploy last

| Var | Required | Value |
|---|---|---|
| `REDIS_URL` | ✅ | |
| `JWT_SECRET` | ✅ | same as identity |
| `IDENTITY_SERVICE_URL` | ✅ | `https://<identity>.onrender.com` — scheme required |
| `MEDIA_SERVICE_URL` | ✅ | `https://<media>.onrender.com` |
| `MATCH_SERVICE_URL` | ✅ | `https://<match>.onrender.com` |
| `INTERNAL_SECRET` | — | shared |
| `NODE_ENV` | — | `production` |

The gateway needs **no** Mongo and **no** RabbitMQ — it only proxies and rate-limits.

---

## 3. Three free-tier behaviours that will bite you

### 3.1 notification-service sleeps and never wakes on its own

**This is the one that silently breaks the product.**

A free Web Service sleeps after ~15 minutes without HTTP traffic. notification-service
has no business HTTP API — nothing ever sends it a request — so it sleeps and stops
consuming from RabbitMQ. No emails go out.

Events are **not lost**: the queues are durable (D-05), so they accumulate and drain
when it next wakes. But nothing wakes it.

**Fix:** point an external uptime pinger at
`https://uff-notification-service.onrender.com/health` every 10 minutes —
cron-job.org, UptimeRobot, or a GitHub Actions schedule. Render's own cron jobs are a
paid feature.

Symptom if you skip this: everything looks healthy, invites and matches work, and
emails simply never arrive.

### 3.2 Cold starts break the enrichment budget

`ENRICHMENT_TIMEOUT_MS` is set to `60000` in the blueprint, up from the 2500 ms default.

match-service enriches invites by calling identity-service through the gateway. If
either is asleep, that call waits out a cold start of tens of seconds. At the default
the request would expire, `Promise.allSettled` would swallow it, and the invite would
publish with `teamId`-only teams — a notification with no team names, and no error
anywhere. See A-13.

60 s is deliberately generous. Lower it if you move to paid instances that do not sleep.

### 3.3 The first request after idle is slow

Cold start is tens of seconds, and a request may traverse several services that are each
asleep. Nothing is broken; it is the tier. If you demo this, hit the gateway once a
minute beforehand to warm the chain.

---

## 4. Security: what INTERNAL_SECRET is protecting

All five services are publicly reachable, which is what the free tier allows.
Downstream services authenticate callers by the `x-team-id` header the gateway injects,
and that header is not signed. Without `INTERNAL_SECRET`, this works from anywhere:

```
curl -H "x-team-id: <any team id>" https://uff-match-service.onrender.com/api/match/get-matches
```

That is full impersonation of any team, with no login.

`INTERNAL_SECRET` makes the gateway inject `x-internal-secret` on every proxied request;
downstream services reject anything without it. Verified in both directions on the local
stack: `401` without the secret, `200` with it.

**Do not deploy with `INTERNAL_SECRET` unset.** The services will start and log a warning
rather than refuse, so the only signal is that warning.

### What `INTERNAL_SECRET` does NOT cover — and why that is now fine

`GET /v1/auth/getTeamById/:id` is still **publicly callable**, and deliberately so. The
gateway does not require a JWT on `/v1/auth` because that is where tokens are issued, and
`INTERNAL_SECRET` cannot help: the request arrives legitimately through the gateway.
Requiring auth on that one route would also break match-service's synchronous enrichment,
which calls it without a token.

That route used to return the full Team document **including the argon2 password hash**.
It no longer does (D-20): `.select('-password')` is applied at both escape points — the
HTTP response and the `TeamDetails` event payload — so the route is still public but
discloses nothing sensitive.

Verified: `getTeamById` returns `_id, teamName, collegeName, email, role, createdAt,
updatedAt, __v`; `$argon2id` appears 0 times in match-service's logs after a full smoke
run, against 1 occurrence historically. The historical hit is what makes the zero
evidence rather than a grep that never matched anything.

It still returns team **email addresses** to anyone with a team id. That is inherent to
the route's purpose — match-service needs them for enrichment — but worth knowing if you
expose this beyond a demo.

---

## 5. What is deliberately NOT deployed

**Mailpit.** It is a local test sink. `SMTP_HOST` must be empty in production or every
notification is delivered to a service that does not exist, with no error.

**The legacy monolith in `/src`.** Excluded from the migration (D-02) and from every
Dockerfile.

---

## 6. Verifying the deployment

The smoke test runs against any gateway URL:

```sh
GATEWAY_URL=https://uff-api-gateway.onrender.com npm run smoke
```

Two caveats on Render:

- The Mailpit assertions (steps 7b) will fail — there is no Mailpit deployed. That is
  expected; the other 19 checks are the meaningful ones.
- Run it twice. The first run wakes sleeping services and may exceed the poll timeouts;
  the second is the real result.

For real email delivery, use `scripts/live-test.mjs` with three real inboxes, exactly as
it was used locally.
