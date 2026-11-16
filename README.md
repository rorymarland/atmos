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

Milestone M3: the first working app. Today (best bet and ranked zones), Map, a detail sheet for
every hill or zone, and Settings. Four profiles so far: hill walking, cloud inversion, golden-hour
sky and still reflections.

## Repository layout

```
apps/web/            SvelteKit 3 static app
packages/engine/     pure TypeScript scoring engine: profiles, factor ramps, vertical interpolation, verdicts
packages/data-client/ Open-Meteo requests, response parsing, batching and caching
config/              zones, photo spots, scoring profiles, hill lists, attributions (YAML, the source of truth)
scripts/             build-time data pipeline (`pnpm build:data`)
data/raw/            hand-downloaded source data, never committed
data/generated/      output of the pipeline, never committed
docker/              multi-stage Dockerfile (builds from source) and nginx config
tools/spike/         browser check of every live data source (open the HTML file in a browser)
```

## Development

Requires Node 22 and pnpm (via Corepack: `corepack enable`).

```sh
pnpm install
pnpm check                          # lint, format check, typecheck, tests
DOBIH_VERSION=18.6 pnpm build       # data pipeline + static site into apps/web/build
pnpm dev                            # dev server (run the build once first for the data)
```

Both builds need the DoBIH CSV at `data/raw/DoBIH.csv`: see [data/raw/README.md](data/raw/README.md).

## Running on the NAS

Docker Compose builds the site from this checkout, so the NAS needs only Docker.

```sh
git clone https://github.com/rorymarland/atmos.git && cd atmos
# put the DoBIH CSV at data/raw/DoBIH.csv
cp .env.example .env               # set ATMOS_PORT, DOBIH_VERSION, defaults
docker compose up -d --build
```

Then point an Nginx Proxy Manager proxy host at `http://<nas>:ATMOS_PORT` (or use the shared proxy
network option commented in `docker-compose.yml`). To update: `git pull && docker compose up -d
--build`.

There are no secrets. `.env` holds the port, the DoBIH version and display defaults, which are baked
in at build time; choices made in the app's Settings override them. Serve it over HTTPS (NPM does
this) if you want "Use my location" to work: browsers only share location with secure sites.

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
