# Build context is the REPO ROOT, not this directory — the workspace layout means
# packages/shared must be present. Build with:
#   docker build -f notification-service/Dockerfile -t uff/notification-service .
#
# This service had no Dockerfile before the port (D-NT-09).

# ---- Build stage: compiles @uff/shared and this service ----
FROM node:24-alpine AS build
WORKDIR /usr/src/app

# All workspace manifests are copied because `npm ci` validates the lockfile against
# every workspace declared in the root package.json — omitting the un-ported services
# makes the install fail even though they are not being built here.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY api-gateway/package.json api-gateway/
COPY identity-service/package.json identity-service/
COPY match-service/package.json match-service/
COPY media-service/package.json media-service/
COPY notification-service/package.json notification-service/

RUN npm ci --workspace @uff/shared --workspace notification-service

COPY packages/shared packages/shared
COPY notification-service notification-service
RUN npm run build -w @uff/shared && npm run build -w notification-service

# ---- Runtime stage: production dependencies and compiled output only ----
FROM node:24-alpine AS runtime
WORKDIR /usr/src/app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY api-gateway/package.json api-gateway/
COPY identity-service/package.json identity-service/
COPY match-service/package.json match-service/
COPY media-service/package.json media-service/
COPY notification-service/package.json notification-service/

RUN npm ci --omit=dev --workspace @uff/shared --workspace notification-service

COPY --from=build /usr/src/app/packages/shared/dist packages/shared/dist
COPY --from=build /usr/src/app/notification-service/dist notification-service/dist

# The service exposes no API — only GET /health, which docker-compose health-checks.
EXPOSE 3005
CMD ["node", "notification-service/dist/server.js"]
