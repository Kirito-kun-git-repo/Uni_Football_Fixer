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

### Still open on this topology

`GET /v1/auth/getTeamById/:id` returns the full Team document — **including the argon2
password hash** — and the gateway deliberately does not require a JWT on `/v1/auth`,
because that is where tokens are issued. So the hash is publicly readable to anyone with
a team id. `INTERNAL_SECRET` does not close this, because the request legitimately comes
through the gateway.

**FIXED** — see D-20. `.select('-password')` on both escape points; `getTeamById` no longer returns
a `password` field and the hash no longer travels the bus. Verified after the fact with a log
grep that still finds the pre-fix occurrence, so the zero is meaningful.

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
