# Builds Atmos from source and serves it with nginx. No Node needed on the host.
#
# Needs data/raw/DoBIH.csv in the build context (see data/raw/README.md).
# Usually run through docker compose, which passes the build arguments from .env.

# --- Build: data pipeline + static site -----------------------------------------
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

ARG DOBIH_VERSION
ARG ATMOS_DEFAULT_THEME=light
ARG ATMOS_DEFAULT_WIND_UNIT=kmh
RUN test -n "$DOBIH_VERSION" || (echo "Set DOBIH_VERSION (e.g. 18.6) in .env" && exit 1)
RUN test -f data/raw/DoBIH.csv || (echo "data/raw/DoBIH.csv is missing: see data/raw/README.md" && exit 1)
RUN DOBIH_VERSION="$DOBIH_VERSION" \
    ATMOS_DEFAULT_THEME="$ATMOS_DEFAULT_THEME" \
    ATMOS_DEFAULT_WIND_UNIT="$ATMOS_DEFAULT_WIND_UNIT" \
    pnpm build

# --- Serve -------------------------------------------------------------------------
FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/apps/web/build/ /usr/share/nginx/html/

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/healthz || exit 1
