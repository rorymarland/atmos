# Atmos: a prebuilt image. The site is built here; the hill data is built when the
# container starts, from the DoBIH CSV mounted at /data. Published to
# ghcr.io/rorymarland/atmos by .github/workflows/publish.yml.

# --- Build: static site + bundled data builder --------------------------------------
FROM node:22-alpine AS build
WORKDIR /src
RUN corepack enable

# Dependencies first, so code changes don't reinstall them.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/engine/package.json packages/engine/
COPY packages/data-client/package.json packages/data-client/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build:web && pnpm bundle:data

# --- Serve ---------------------------------------------------------------------------
FROM nginx:1.27-alpine

# Node runs the data builder once at start-up (about two seconds).
RUN apk add --no-cache nodejs

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/entrypoint/40-atmos-data.sh /docker-entrypoint.d/40-atmos-data.sh
COPY --from=build /src/apps/web/build/ /usr/share/nginx/html/
COPY --from=build /src/dist/build-data.mjs /opt/atmos/build-data.mjs
COPY config/ /opt/atmos/config/
RUN chmod +x /docker-entrypoint.d/40-atmos-data.sh

# The folder holding the DoBIH CSV (any name, e.g. DoBIH_v18_6.csv), mounted read-only.
VOLUME /data

ENV ATMOS_DEFAULT_THEME=light \
    ATMOS_DEFAULT_WIND_UNIT=kmh \
    DOBIH_VERSION=

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/healthz || exit 1
