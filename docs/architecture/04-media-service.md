# `media-service`

Handles team logo uploads. Accepts a multipart file, streams it to **Cloudinary**, records the resulting
URL in its own `Media` collection, and announces the change on the bus so `identity-service` can update
`Team.logoUrl`.

Port: `3003` (`PORT ?? 3003`). Reached via the gateway at `/v1/media/*` → `/api/media/*`.

---

## 1. Tech stack

| Layer | Package | Version | Role |
|---|---|---|---|
| Runtime | Node.js | `node:18-alpine` (Dockerfile, `EXPOSE 3003`) | EOL |
| HTTP | `express` | `^5.1.0` | |
| ODM | `mongoose` | `^8.17.1` | MongoDB |
| File upload | `multer` | `^2.0.2` | `memoryStorage`, 10 MB limit, single field `file` |
| Object storage | `cloudinary` | `^2.7.0` | `upload_stream` with `resource_type: 'auto'` |
| Messaging | `amqplib` | `^0.10.8` | publisher only |
| Redis | `redis` | `^5.8.1` | node-redis v5 (`createClient`) — **not** `ioredis`, unlike the other services |
| Rate limiting | `express-rate-limit` `^8.0.1` + `rate-limit-redis` `^4.2.2` | | **actually enabled**: 50 req/min on `/api/media` |
| Headers / CORS | `helmet` `^8.1.0`, `cors` `^2.8.5` | | |
| Validation | `joi` `^18.0.0` | | **installed but unused** |
| Auth | `jsonwebtoken` `^9.0.2` | | **installed but unused** — header trust only |
| Logging | `winston` `^3.17.0` | | |
| Config | `dotenv` `^17.2.1` | | |

This is the only service besides the gateway with a **working** rate limiter.

---

## 2. Directory structure

```
media-service/
├── Dockerfile                          # node:18-alpine, EXPOSE 3003
├── package.json
└── src/
    ├── server.js
    ├── routes/
    │   └── media-routes.js             # /api/media
    ├── controllers/
    │   └── media-controller.js         # uploadMedia, getAllMedia
    ├── models/
    │   └── Media.js
    ├── eventHandlers/
    │   └── media-event-handlers.js     # ⚠️ exports an empty object (all code commented out)
    ├── middleware/
    │   ├── authMiddleware.js           # authenticateRequest — trusts x-team-id
    │   └── errorHandler.js
    └── utils/
        ├── cloudinary.js               # uploadMediaToCloudinary, deleteMediaFromCloudinary
        ├── rabbitmq.js
        └── logger.js
```

---

## 3. Boot sequence (`src/server.js`)

```
1.  dotenv.config()
2.  mongoose.connect(MONGODB_URL)              ← not awaited
3.  createClient({ url: REDIS_URL }); redisClient.connect()   ← unawaited promise
4.  cors(), helmet(), express.json(), request logger
5.  app.use('/api/media', sensitiveRateLimiter)   // 50 req / 1 min per IP, Redis-backed
6.  app.use('/api/media', mediaRoutes)
7.  app.use(errorHandler)
8.  startServer():
      await connectToRabbitMQ()
      // consumeEvent('post.deleted', handlePostDeleted)  ← commented out
      app.listen(PORT ?? 3003)
```

This service **publishes but never consumes**. `handlePostDeleted` is imported from
`media-event-handlers.js`, which exports `{}` — so the import is `undefined`. It is harmless only because
the `consumeEvent` call that would use it is commented out.

---

## 4. Data model — `Media` (`media`)

| Field | Type | Constraints |
|---|---|---|
| `publicId` | String | required, **unique** — Cloudinary `public_id`, used for deletion |
| `originalName` | String | required — client filename |
| `mimeType` | String | required |
| `url` | String | required — Cloudinary `secure_url` |
| `teamId` | ObjectId, `ref: 'User'` | required — ⚠️ there is no `User` model anywhere in the system |
| `createdAt` / `updatedAt` | Date | `timestamps: true` |

The `teamId` type is inconsistent with the rest of the stack: `match-service` and
`notification-service` store team ids as plain `String`, and the referenced model `'User'` does not exist
(the entity is called `Team`). The `ref` is inert here since nothing calls `.populate()` on it.

---

## 5. HTTP API (`/api/media`, public as `/v1/media`)

| Method | Path | Auth | Handler | Behaviour |
|---|---|---|---|---|
| `POST` | `/upload-logo` | `authenticateRequest` (x-team-id) | `uploadMedia` | multer parses `file` → Cloudinary upload → persist `Media` → publish `profilePhoto.updated` → `201 {mediaId, publicId, url, teamId}` |
| `GET` | `/get` | `authenticateRequest` | `getAllMedia` | `Media.find({})` — **every** media row for **every** team |

### Upload flow

```mermaid
sequenceDiagram
    participant C as Client
    participant GW as api-gateway
    participant MD as media-service
    participant CL as Cloudinary
    participant DB as MongoDB
    participant MQ as RabbitMQ
    participant ID as identity-service

    C->>GW: POST /v1/media/upload-logo (multipart/form-data, field "file")
    GW->>GW: validateToken → x-team-id
    Note over GW: Content-Type left as multipart<br/>(only non-multipart is rewritten to JSON)
    GW->>MD: POST /api/media/upload-logo
    MD->>MD: rate limit 50/min → authenticateRequest → multer.memoryStorage (≤10MB)
    MD->>CL: cloudinary.uploader.upload_stream(buffer, {resource_type:'auto'})
    CL-->>MD: {public_id, secure_url}
    MD->>DB: Media.save({publicId, url, originalName, mimeType, teamId})
    MD->>MQ: publish profilePhoto.updated {teamId, url}
    MD-->>C: 201 {mediaId, publicId, url, teamId}
    MQ->>ID: handleProfileUploadEvent → team.logoUrl = url; save()
```

The multer error handling is done manually inside a wrapper route handler: `MulterError` → `400`,
other errors → `500`, missing file → `400`, otherwise `next()` into `uploadMedia`.

### `utils/cloudinary.js`

```js
cloudinary.config({ cloud_name: CLOUD_NAME, api_key: CLOUDINARY_API_KEY, api_secret: CLOUDINARY_API_SECRET });

uploadMediaToCloudinary(file)    // wraps upload_stream in a Promise, writes file.buffer
deleteMediaFromCloudinary(id)    // cloudinary.uploader.destroy(publicId)  ← exported, never called
```

---

## 6. Events

| Direction | Routing key | Payload | Consumer |
|---|---|---|---|
| **Publishes** | `profilePhoto.updated` | `{ url, teamId }` (both stringified) | `identity-service.handleProfileUploadEvent` |
| **Consumes** | — | — | none (the `post.deleted` subscription is commented out) |

---

## 7. Configuration (`.env`)

| Variable | Used for |
|---|---|
| `PORT` | default `3003` |
| `MONGODB_URL` | mongoose |
| `REDIS_URL` | rate-limit store (this one **is** used) |
| `RABBITMQ_URL` | amqplib |
| `CLOUD_NAME` | Cloudinary account |
| `CLOUDINARY_API_KEY` | Cloudinary |
| `CLOUDINARY_API_SECRET` | Cloudinary |

---

## 8. Known issues / tech debt

| # | Issue | Where | Impact |
|---|---|---|---|
| 1 | **`GET /get` returns every media document in the system**, no `teamId` filter, no pagination | `media-controller.js:60-74` | any authenticated team can enumerate all uploads; unbounded payload |
| 2 | `Media.teamId` is `ObjectId, ref: 'User'` — a model that does not exist; every other service uses `String` | `Media.js:21-25` | type mismatch across the boundary; the ref is meaningless |
| 3 | No file-type validation — `multer` accepts any mimetype and Cloudinary is called with `resource_type: 'auto'` | `media-routes.js:9-12`, `cloudinary.js:19` | arbitrary file types accepted as "logos" |
| 4 | Old media is never deleted — a team uploading N logos leaves N-1 orphans in Cloudinary and Mongo | `media-controller.js` | storage cost grows unbounded; `deleteMediaFromCloudinary` exists but is never called |
| 5 | `handlePostDeleted` imported from a module that exports `{}` | `server.js:15` | dead import; the whole `eventHandlers` file is commented out |
| 6 | `redisClient.connect()` is not awaited and its rejection is unhandled | `server.js:37` | first requests can hit the rate limiter before Redis is ready |
| 7 | `logger.info(\`Media uploaded successfully to Cloudinary: ${result}\`)` and `cloudinaryUploadResult.public_Id` (wrong casing → `undefined`) | `media-controller.js:22`, `cloudinary.js:28` | broken log lines |
| 8 | `console.log(req.file)` left in the controller | `media-controller.js:23` | dumps the full file buffer metadata to stdout |
| 9 | `memoryStorage` with a 10 MB cap and no concurrency limit | `media-routes.js:10` | N concurrent uploads = N × 10 MB resident; no streaming to Cloudinary |
| 10 | No `Media` uniqueness or index on `teamId` | `Media.js` | lookups by team scan the collection |
| 11 | Unused dependencies: `joi`, `jsonwebtoken` | `package.json` | dead weight |
| 12 | Cloudinary credentials read at module load with no validation | `cloudinary.js:9-13` | misconfiguration surfaces only on the first upload |
| 13 | The gateway's multipart detection (`headers['content-type'].startsWith`) throws on requests with no `Content-Type` | `api-gateway/src/server.js:104` | `GET /v1/media/get` from a client that omits the header 500s at the gateway |
| 14 | `Dockerfile` on `node:18-alpine` with deprecated `npm ci --only=production` | `Dockerfile` | EOL base image |
| 15 | No response for the "no file" case is distinguished from a Multer limit error at the client level | `media-routes.js:17-28` | both surface as `400` with different shapes |
