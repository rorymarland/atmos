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
