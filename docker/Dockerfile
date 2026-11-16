# Builds Atmos from source and serves it with nginx. No Node needed on the host.
#
# Needs the DoBIH CSV in data/raw/ (any name; see data/raw/README.md).
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
RUN ls data/raw/*.csv >/dev/null 2>&1 || ( \
      echo "No DoBIH CSV in data/raw/. Download the csv version from" \
      "https://www.hills-database.co.uk/downloads.html and put it there."; \
      echo "data/raw/ contains:"; ls -la data/raw/; exit 1 )
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
