# Atmos

**Atmos. Find the conditions. Capture the moment.**

Atmos ranks UK regions, hills and personal photo spots for the next five days against a chosen
profile: hill walking, cloud inversion, golden-hour sky, still reflections, valley mist, astro/aurora
or snow on the tops. Every verdict (GO / MAYBE / NO) comes with the reasons behind it and how far the
weather models agree.

It is a fully static web app: the browser fetches forecasts directly from free public APIs, and the
host only serves files. It runs as an nginx container on a home NAS and could later sit on any free
static host.

> **A guide, not a safety service.** Always check the [Met Office mountain forecast](https://www.metoffice.gov.uk/weather/specialist-forecasts/mountain)
> and [MWIS](https://www.mwis.org.uk/) before going onto the hills.

## Status

Early development. See the milestones in the design plan; the current focus is the data pipeline and
scoring engine (M1 and M2). There is no user interface yet.

## Repository layout

```
apps/web/            SvelteKit app (milestone M3)
packages/engine/     pure TypeScript scoring engine: profiles, factor ramps, vertical interpolation, verdicts
config/              zones, photo spots, scoring profiles, hill lists, attributions (YAML, the source of truth)
scripts/             build-time data pipeline (`pnpm build:data`)
data/raw/            hand-downloaded source data, never committed
data/generated/      output of the pipeline, never committed
docker/              nginx image for self-hosting
```

## Development

Requires Node 22 and pnpm (via Corepack: `corepack enable`).

```sh
pnpm install
pnpm check          # lint, format check, typecheck, tests
pnpm build:data --dobih-version 18.3   # needs data/raw/DoBIH.csv, see data/raw/README.md
```

## Data and attribution

| Source                                                                                               | Use                                    | Licence / terms                               |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------- |
| [Open-Meteo](https://open-meteo.com/) (UK Met Office, ECMWF, DWD ICON models)                        | Forecasts, fetched live by the browser | CC BY 4.0; free API is for non-commercial use |
| [Database of British and Irish Hills](https://www.hills-database.co.uk/) (DoBIH)                     | Hill names, heights, positions, lists  | CC BY 4.0                                     |
| [AuroraWatch UK](https://aurorawatch.lancs.ac.uk/), Lancaster University                             | Aurora alert status (planned)          | Non-commercial use only; credit and link      |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) via [OpenFreeMap](https://openfreemap.org/) | Basemap (planned)                      | ODbL                                          |

## Licence

Atmos is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE). You may use,
copy and modify it for any non-commercial purpose; commercial use is not permitted. This matches the
terms of the free data services it depends on.
