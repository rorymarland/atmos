# Atmos: notes for AI assistants

## Project rules

- Atmos is a **fully static** site. No application server, no database, no proxy. Live data is
  fetched by the browser from free public APIs that allow CORS; everything else is generated at
  build time into small static files.
- **UK only** (England, Scotland, Wales, Northern Ireland). Republic of Ireland hills are excluded.
- **Free, keyless data only.** Never add a source that needs a paid plan or an API key embedded in the
  client.
- **Private, non-commercial use.** Licensed under PolyForm Noncommercial 1.0.0. Do not add ads,
  analytics or anything commercial.
- Never hard-code a start location. The user can save a home (postcode or place name, kept only in
  their browser) and change today's start point at any time. Drive times are estimates from
  straight-line distance and typical road speeds (`packages/engine/src/travel.ts`), always shown
  as approximate, with a Google Maps directions link for the real route. No routing API: none is
  free, keyless and allowed for app use.
- UI defaults to a light theme, with dark mode available as an option.

## Conventions

- British English in all user-facing text and docs. No em dashes.
- Units: °C, metres for heights, km for walking distances, miles for driving distances, 24-hour
  time. Wind speed is configurable (km/h default, mph option). Internally the engine uses km/h, °C,
  m, hPa, %, mm.
- `packages/engine` is pure TypeScript with no DOM or network access, so it runs in tests, the
  browser and build scripts alike.
- Scoring thresholds and weights live in `config/profiles.yaml`, not in code. Each condition
  there also declares `scope` (summit or valley), `periods` and whether it counts towards the
  photo score; the web app scores every hill for every condition and period.
- Open-Meteo allows 600 call-equivalents a minute. `packages/data-client/src/zones.ts` keeps a
  shared budget: the main forecast loads first, then HARMONIE and the horizon points (which may
  wait for the next minute). Check `estimateCallWeight` before adding variables or models.
- Walking routes (`packages/engine/src/route.ts`) are worked out in the browser on demand: the
  open hill, then the top three results, one at a time, saved in IndexedDB for 30 days. Keep
  Overpass use to that (its fair-use policy); never route every hill from the browser. Bump
  `ROUTE_VERSION` in `apps/web/src/lib/routes.ts` when the route maths changes.
- Every change keeps `pnpm check` green (lint, format, typecheck, tests).

## SvelteKit 3 notes (apps/web)

- Config lives in `vite.config.ts` via `sveltekit({...})`; there is no `svelte.config.js`.
- `$lib` is gone: import with `#lib/...` (package.json `imports`) and include the file extension,
  e.g. `#lib/conditions.svelte.ts`, `#lib/components/AirColumn.svelte`.
- `tsconfig.json` extends `$app/tsconfig`.
- `goto` takes `replace` and `reset` (no `noScroll`/`keepFocus`); links use
  `data-sveltekit-reset="false"` to keep scroll position.
- Display defaults are runtime, not build time: `static/defaults.js` sets
  `window.__ATMOS_DEFAULTS__`, and the container rewrites it at start from `.env` (deleting the
  precompressed `.gz`/`.br` copies so nginx doesn't serve stale ones).

## Docker image

- Published to `ghcr.io/rorymarland/atmos` by `.github/workflows/publish.yml` on merges to main.
- The image contains no hill data. `docker/entrypoint/40-atmos-data.sh` runs the bundled
  `dist/build-data.mjs` at container start against the CSV mounted at `/data`.
- nginx must serve `.mjs` as JavaScript (the MapLibre worker); see `docker/nginx.conf`.
- MapLibre 6 needs `setWorkerUrl(...)` with the worker module imported via `?url`. Layer
  errors arrive as `error` events, not exceptions; zoom expressions must be top-level.
