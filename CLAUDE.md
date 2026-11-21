# Atmos: notes for AI assistants

## Project rules

- Atmos is a **fully static** site. No application server, no database, no proxy. Live data is
  fetched by the browser from free public APIs that allow CORS; everything else is generated at
  build time into small static files.
- The one exception is **alerts** (`apps/alerts`), a separate, optional container: a small
  Node API at `/api/alerts`, `/api/places` and `/api/forecasts` (nginx proxies `/api/`) plus an
  hourly scheduler that emails people. It also fetches every zone's forecasts and shares them
  (`apps/alerts/src/forecasts.ts`): each feed is refetched only after its minimum gap and once a
  one-call probe shows a new run, inside a daily budget, because Open-Meteo's free limit is
  about 10,000 calls a day per IP. The browser uses that copy first
  (`apps/web/src/lib/shared-forecasts.ts`) and fetches from Open-Meteo itself only without it,
  or for zones it doesn't hold. Haze and dust come from Open-Meteo's air quality API (CAMS,
  `AIR_REQUEST`, the `air` feed, every 12 hours, no probe) and feed the `haze` factor
  (sky, drama, clear air). It also samples aircraft above 25,000 ft over the UK from
  OpenSky's anonymous API every 12 minutes (`apps/alerts/src/traffic.ts`, about 360 of its 400
  daily credits; `ATMOS_TRAFFIC=off` stops it), for plane trails later. It also keeps shared **custom places**; without it the web app
  keeps places in localStorage. Custom places (`packages/engine/src/places.ts`) are merged in
  with `withPlaces` by both the web app and the service: numbers from 1,000,001 (2,000,001 for
  browser-only), each with its own forecast zone appended after the generated zones. The site must keep working without it (the Alerts UI hides when
  `/api/alerts/status` fails). It scores with `apps/web/src/lib/evaluate-places.ts`, the same
  code as the website: change scoring there, not in a copy. No accounts: Atmos is LAN/VPN only
  and each alert just names an email address.
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
- Open-Meteo allows 600 call-equivalents a minute and about 10,000 a day per IP. `packages/data-client/src/zones.ts` keeps a
  shared budget: the main forecast loads first, then HARMONIE and the horizon points (which may
  wait for the next minute). Check `estimateCallWeight` before adding variables or models.
- Walking routes (`packages/engine/src/route.ts`) are worked out in the browser on demand: the
  open hill, then the top three results, one at a time, saved in IndexedDB for 30 days. Keep
  Overpass use to that (its fair-use policy); never route every hill from the browser. Bump
  `ROUTE_VERSION` in `apps/web/src/lib/routes.ts` when the route maths changes.
- Still water (`data/water/uk-water.json`) is built from the Geofabrik UK extract by the "Water
  data" workflow (`.github/workflows/water.yml`, `scripts/build-water.ts`), never in the browser
  or at container start. Rerun it from the Actions tab to refresh; it opens a pull request.
  `build-data` links each hill to still water within 3 km and writes `waters.json`. Profiles
  with `water:` in `profiles.yaml` are scored per loch, and their trips end at the lochside.
- The viewer (`packages/engine/src/panorama.ts`, `apps/web/src/lib/panorama.worker.ts`,
  `PanoramaStrip.svelte`) and Line it up (`alignment.ts`) share the same curve and refraction
  maths (`elevationAngle`); a test checks they agree. Terrain is Mapterhorn at zoom 11 (to
  25 km), 10 (to 60 km) and 8 (to 150 km), decoded to decimetre heights (`HeightTile`) in a
  worker that keeps the current standpoint's terrain. Steps never pass a terrain pixel; the
  full circle is every 0.1°, and the 100 and 200 mm lenses get a 0.02° or 0.01° slice across
  the view. The land is drawn from a steepness and distance picture (`PanoramaShade`) under
  the ridgelines. It's the hot loop: keep it free of per-sample trig and allocation.
- Plane trails (`packages/engine/src/contrails.ts`): formation by Schmidt–Appleman, lingering
  where ECMWF's humidity (already relative to ice below −23 °C) is 90% or more, hidden by thick
  mid or high cloud. Upper air comes from `UPPER_REQUEST` (the `upper` shared feed). A
  condition's `trails` weight in `profiles.yaml` says how much trails matter to it. It's a
  warning plus a ranking penalty when "Avoid plane trails" is on, never part of the verdict.
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
