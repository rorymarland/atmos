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
- Never assume a fixed start location. Distances are straight-line estimates in miles from a
  user-chosen point, plus a Google Maps directions link for the real route.
- UI defaults to a light theme, with dark mode available as an option.

## Conventions

- British English in all user-facing text and docs. No em dashes.
- Units: °C, metres for heights, km for walking distances, miles for driving distances, 24-hour
  time. Wind speed is configurable (km/h default, mph option). Internally the engine uses km/h, °C,
  m, hPa, %, mm.
- `packages/engine` is pure TypeScript with no DOM or network access, so it runs in tests, the
  browser and build scripts alike.
- Scoring thresholds and weights live in `config/profiles.yaml`, not in code.
- Every change keeps `pnpm check` green (lint, format, typecheck, tests).

## SvelteKit 3 notes (apps/web)

- Config lives in `vite.config.ts` via `sveltekit({...})`; there is no `svelte.config.js`.
- `$lib` is gone: import with `#lib/...` (package.json `imports`) and include the file extension,
  e.g. `#lib/conditions.svelte.ts`, `#lib/components/AirColumn.svelte`.
- `tsconfig.json` extends `$app/tsconfig`.
- `goto` takes `replace` and `reset` (no `noScroll`/`keepFocus`); links use
  `data-sveltekit-reset="false"` to keep scroll position.
- Build-time defaults reach the client through Vite `define` (`__ATMOS_DEFAULTS__`).
- MapLibre 6 needs `setWorkerUrl(...)` with the worker module imported via `?url`. Layer
  errors arrive as `error` events, not exceptions; zoom expressions must be top-level.
