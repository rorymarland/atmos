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

Milestone M3: the first working app. The map is the home page, with a collapsible panel for
choosing a profile, day, filters and start point and for the ranked areas; a detail sheet explains
every hill or zone. Four profiles so far: hill walking, cloud inversion, golden-hour
sky and still reflections.

Trip planning: set a home by postcode or place name (Settings), choose what to be in place for
(blue hour, golden hour, sunrise or sunset), the earliest you're willing to get up and the longest
drive. Every area then gets a rough get-up and leave time, and places that would need an earlier
start are listed separately. Drive times are estimates from straight-line distance and typical
road speeds; walk-ins use Naismith's rule. The Google Maps link gives the real route.

## Repository layout

```
apps/web/            SvelteKit 3 static app
packages/engine/     pure TypeScript scoring engine: profiles, factor ramps, vertical interpolation, verdicts
packages/data-client/ Open-Meteo requests, response parsing, batching and caching
config/              zones, photo spots, scoring profiles, hill lists, attributions (YAML, the source of truth)
scripts/             build-time data pipeline (`pnpm build:data`)
data/raw/            hand-downloaded source data, never committed
data/generated/      output of the pipeline, never committed
docker/              Dockerfile, nginx config and the container start-up script
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

The image is built by GitHub Actions on every merge to `main` and published as
`ghcr.io/rorymarland/atmos:latest`. The NAS needs only three files in one folder:

```
atmos/
├── docker-compose.yml   from this repository
├── .env                 from .env.example
└── DoBIH_v18_6.csv      the hills database download (keep its name)
```

```sh
docker compose up -d                          # first run
docker compose pull && docker compose up -d   # update to the latest version
```

The folder is mounted read-only; each time the container starts it builds the hill data from the
CSV (about two seconds) and writes the display defaults from `.env`. A new DoBIH release only
needs the new CSV in place of the old one and `docker compose restart`.

Point an Nginx Proxy Manager proxy host at `http://<nas>:ATMOS_PORT`, or use the shared proxy
network option commented in `docker-compose.yml`. Serve it over HTTPS if you want "Use my location"
to work: browsers only share location with secure sites. "Pick on map" works either way.

To build the image from a checkout instead:
`docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`.

## Data and attribution

| Source                                                                                               | Use                                    | Licence / terms                               |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------- |
| [Open-Meteo](https://open-meteo.com/) (UK Met Office, ECMWF, DWD ICON models)                        | Forecasts, fetched live by the browser | CC BY 4.0; free API is for non-commercial use |
| [Database of British and Irish Hills](https://www.hills-database.co.uk/) (DoBIH)                     | Hill names, heights, positions, lists  | CC BY 4.0                                     |
| [Postcodes.io](https://postcodes.io/) (OS, Royal Mail and ONS data)                                  | Finding home from a postcode           | OGL v3.0                                      |
| [GeoNames](https://www.geonames.org/) via Open-Meteo geocoding                                       | Finding home from a place name         | CC BY 4.0                                     |
| [AuroraWatch UK](https://aurorawatch.lancs.ac.uk/), Lancaster University                             | Aurora alert status (planned)          | Non-commercial use only; credit and link      |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) via [OpenFreeMap](https://openfreemap.org/) | Basemap (planned)                      | ODbL                                          |

## Licence

Atmos is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE). You may use,
copy and modify it for any non-commercial purpose; commercial use is not permitted. This matches the
terms of the free data services it depends on.
