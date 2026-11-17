# Atmos alerts: the optional service that checks the forecast for saved alerts and emails
# them. Published to ghcr.io/rorymarland/atmos-alerts by .github/workflows/publish.yml.

FROM node:22-alpine AS build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/alerts/package.json apps/alerts/
COPY packages/engine/package.json packages/engine/
COPY packages/data-client/package.json packages/data-client/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm bundle:alerts

FROM node:22-alpine
WORKDIR /app
COPY --from=build /src/apps/alerts/dist/alerts.mjs /app/alerts.mjs
# alerts.json lives here: mount a folder so alerts survive updates.
VOLUME /data
ENV PORT=8080 ALERTS_DATA_DIR=/data ATMOS_DATA_URL=http://atmos/data NODE_ENV=production
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/api/alerts/status || exit 1
CMD ["node", "/app/alerts.mjs"]
