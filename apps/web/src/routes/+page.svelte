<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import { conditions } from '#lib/conditions.svelte.ts';
  import { settings } from '#lib/settings.svelte.ts';
  import { ageLabel, dayLabel, formatTime } from '#lib/time.ts';
  import Controls from '#lib/components/Controls.svelte';
  import ResultsList, { type Pick } from '#lib/components/ResultsList.svelte';
  import VerdictMark from '#lib/components/VerdictMark.svelte';

  const PANEL_KEY = 'atmos.panelOpen';
  const VERDICT_COLOURS = { go: '#2f7a50', maybe: '#b98318', no: '#a3412b', nodata: '#8a979f' };
  const RANK = { go: 3, maybe: 2, no: 1, nodata: 0 } as const;
  const empty = { type: 'FeatureCollection' as const, features: [] };

  let container: HTMLDivElement;
  let map: MapLibreMap | null = $state(null);
  let loaded = $state(false);
  let mapError = $state<string | null>(null);
  let picking = $state(false);
  let panelOpen = $state(true);
  let narrow = $state(false);

  const ranking = $derived(conditions.ranking);
  const best = $derived(
    ranking.zones.find((z) => z.result.verdict === 'go' || z.result.verdict === 'maybe') ?? null,
  );
  const bestName = $derived(best ? (ranking.summitProfile && best.hills[0] ? best.hills[0].hill.name : best.zone.name) : null);
  const profileLabel = $derived(conditions.data?.config.profiles[settings.profile]?.label ?? '');

  const features = $derived.by(() => {
    if (ranking.summitProfile) {
      return [...ranking.hillsByNumber.values()].map((h) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [h.hill.lon, h.hill.lat] },
        properties: { kind: 'hill', id: h.hill.number, name: h.hill.name, verdict: h.result.verdict, rank: RANK[h.result.verdict] },
      }));
    }
    return ranking.zones.map((z) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [z.zone.forecastPoint.lon, z.zone.forecastPoint.lat] },
      properties: { kind: 'zone', id: z.zone.id, name: z.zone.name, verdict: z.result.verdict, rank: RANK[z.result.verdict] },
    }));
  });

  function point(lat: number, lon: number) {
    return {
      type: 'FeatureCollection' as const,
      features: [{ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [lon, lat] }, properties: {} }],
    };
  }

  function setSource(id: string, data: Parameters<GeoJSONSource['setData']>[0]) {
    (map?.getSource(id) as GeoJSONSource | undefined)?.setData(data);
  }

  /** Keep the map's centre in the part of the map the panel doesn't cover. */
  function mapPadding() {
    if (!panelOpen) return { top: 20, bottom: 20, left: 20, right: 20 };
    return narrow
      ? { top: 20, bottom: Math.round(window.innerHeight * 0.55), left: 20, right: 20 }
      : { top: 20, bottom: 20, left: 20, right: 420 };
  }

  function select(p: Pick) {
    const fly = () =>
      map?.flyTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), p.zoom), padding: mapPadding(), speed: 1.4 });
    if (narrow && panelOpen) {
      // Let the drawer close (and the map re-centre) first, or the fly-to is cut short.
      panelOpen = false;
      setTimeout(fly, 350);
    } else {
      fly();
    }
    goto(p.href, { reset: false });
  }

  function hover(p: { lat: number; lon: number } | null) {
    setSource('highlight', p ? point(p.lat, p.lon) : empty);
  }

  onMount(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    narrow = mq.matches;
    const saved = localStorage.getItem(PANEL_KEY);
    panelOpen = saved === null ? !narrow : saved === '1';
    const onMq = () => (narrow = mq.matches);
    mq.addEventListener('change', onMq);

    let destroyed = false;
    (async () => {
      const [maplibre, worker] = await Promise.all([
        import('maplibre-gl'),
        // MapLibre 6 runs its tile worker from a separate module file.
        import('maplibre-gl/dist/maplibre-gl-worker.mjs?url'),
      ]);
      if (destroyed) return;
      maplibre.setWorkerUrl(worker.default);
      const m = new maplibre.Map({
        container,
        style: 'https://tiles.openfreemap.org/styles/liberty',
        bounds: [
          [-8.3, 49.9],
          [1.9, 60.9],
        ],
        fitBoundsOptions: { padding: mapPadding() },
        attributionControl: { compact: true },
      });
      // MapLibre reports bad layers and failed tiles as events, not exceptions.
      m.on('error', (e) => {
        const msg = e.error?.message ?? String(e);
        console.warn('Map:', msg);
        if (!loaded && /style|worker/i.test(msg)) mapError = `The map couldn’t load (${msg}).`;
      });
      m.addControl(new maplibre.NavigationControl({ visualizePitch: true }), 'top-left');
      m.on('load', () => {
        mapError = null;
        const firstSymbol = m.getStyle().layers.find((l) => l.type === 'symbol')?.id;
        m.addSource('terrain-dem', {
          type: 'raster-dem',
          tiles: ['https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'],
          encoding: 'terrarium',
          tileSize: 512,
          maxzoom: 12,
          attribution: '<a href="https://mapterhorn.com/attribution">© Mapterhorn</a>',
        });
        m.addLayer(
          {
            id: 'hillshade',
            type: 'hillshade',
            source: 'terrain-dem',
            paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#4c5b67' },
          },
          firstSymbol,
        );
        m.addSource('targets', { type: 'geojson', data: empty });
        m.addSource('highlight', { type: 'geojson', data: empty });
        m.addSource('start', { type: 'geojson', data: empty });
        m.addLayer({
          id: 'targets',
          type: 'circle',
          source: 'targets',
          layout: { 'circle-sort-key': ['get', 'rank'] },
          paint: {
            // Zoom must be the top-level input; the zone/hill choice goes inside each stop.
            'circle-radius': [
              'interpolate', ['linear'], ['zoom'],
              5, ['case', ['==', ['get', 'kind'], 'zone'], 8, 3.5],
              9, ['case', ['==', ['get', 'kind'], 'zone'], 12, 7],
            ],
            'circle-color': [
              'match', ['get', 'verdict'],
              'go', VERDICT_COLOURS.go,
              'maybe', VERDICT_COLOURS.maybe,
              'no', VERDICT_COLOURS.no,
              VERDICT_COLOURS.nodata,
            ],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 1,
            'circle-opacity': ['case', ['==', ['get', 'verdict'], 'no'], 0.55, 0.95],
          },
        });
        m.addLayer({
          id: 'highlight',
          type: 'circle',
          source: 'highlight',
          paint: {
            'circle-radius': 14,
            'circle-color': 'rgba(0,0,0,0)',
            'circle-stroke-color': '#d9a13b',
            'circle-stroke-width': 3,
          },
        });
        m.addLayer({
          id: 'start',
          type: 'circle',
          source: 'start',
          paint: {
            'circle-radius': 6,
            'circle-color': '#1b2731',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 3,
          },
        });
        // Labels are a nicety: never let a font problem stop the points from working.
        try {
          m.addLayer({
            id: 'target-labels',
            type: 'symbol',
            source: 'targets',
            minzoom: 8,
            layout: {
              'text-field': ['get', 'name'],
              'text-font': ['Noto Sans Regular'],
              'text-size': 12,
              'text-offset': [0, 1.1],
              'text-anchor': 'top',
              'text-optional': true,
            },
            paint: { 'text-color': '#1b2731', 'text-halo-color': '#ffffff', 'text-halo-width': 1.2 },
          });
        } catch (e) {
          console.warn('Hill labels unavailable', e);
        }
        m.on('click', 'targets', (e) => {
          if (picking) return;
          const f = e.features?.[0];
          if (!f) return;
          const p = f.properties as { kind: string; id: string | number };
          goto(p.kind === 'hill' ? `?hill=${p.id}` : `?zone=${p.id}`, { reset: false });
        });
        m.on('click', (e: MapMouseEvent) => {
          if (!picking) return;
          settings.start = {
            lat: Math.round(e.lngLat.lat * 1e4) / 1e4,
            lon: Math.round(e.lngLat.lng * 1e4) / 1e4,
            label: 'the point you picked',
          };
          picking = false;
        });
        m.on('mouseenter', 'targets', () => (m.getCanvas().style.cursor = 'pointer'));
        m.on('mouseleave', 'targets', () => (m.getCanvas().style.cursor = picking ? 'crosshair' : ''));
        loaded = true;
      });
      map = m;
    })();
    return () => {
      destroyed = true;
      mq.removeEventListener('change', onMq);
      map?.remove();
    };
  });

  $effect(() => {
    const data = { type: 'FeatureCollection' as const, features };
    if (map && loaded) setSource('targets', data);
  });

  $effect(() => {
    const s = settings.start;
    if (map && loaded) setSource('start', s ? point(s.lat, s.lon) : empty);
  });

  $effect(() => {
    if (map) map.getCanvas().style.cursor = picking ? 'crosshair' : '';
  });

  // Re-centre the visible part of the map when the panel opens, closes or changes shape.
  $effect(() => {
    void panelOpen;
    void narrow;
    if (map && loaded) map.easeTo({ padding: mapPadding(), duration: 300 });
  });

  $effect(() => {
    try {
      localStorage.setItem(PANEL_KEY, panelOpen ? '1' : '0');
    } catch {
      // Not saved: fine.
    }
  });

  function startPicking() {
    picking = !picking;
    if (picking && narrow) panelOpen = false;
  }
</script>

<svelte:head><title>Atmos: {profileLabel} {dayLabel(settings.dayOffset).toLowerCase()}</title></svelte:head>

<div class="map-page">
  <div class="map" bind:this={container} role="region" aria-label="Map of hills coloured by verdict"></div>

  {#if mapError}
    <p class="map-error small" role="alert">{mapError} Results are still in the panel.</p>
  {/if}

  {#if picking}
    <div class="pick-banner small" role="status">
      Click the map where you’re starting from.
      <button class="button quiet" onclick={() => (picking = false)}>Cancel</button>
    </div>
  {/if}

  <div class="legend small" aria-hidden="true">
    <span><i style="background: var(--go)"></i>Go</span>
    <span><i style="background: var(--maybe)"></i>Maybe</span>
    <span><i style="background: var(--no)"></i>No</span>
    {#if settings.start}<span><i class="start-dot"></i>Start</span>{/if}
  </div>

  {#if panelOpen}
    <aside class="panel" aria-label="Where to go">
      <header class="panel-head">
        <h1>Where to go</h1>
        <button class="hide" onclick={() => (panelOpen = false)} aria-label="Hide the panel">Hide</button>
      </header>
      <div class="panel-body">
        <Controls {picking} onPickStart={startPicking} />

        <div class="status small muted" aria-live="polite">
          {#if conditions.error}
            <span class="error">{conditions.error}</span>
            <button class="link" onclick={() => conditions.refresh(true)}>Try again</button>
          {:else if conditions.loading}
            Fetching forecasts{#if conditions.progress}, {conditions.progress.done} of {conditions.progress.total}{/if}…
          {:else if conditions.fetchedAt}
            Forecasts from {formatTime(conditions.fetchedAt)} ({ageLabel(conditions.fetchedAt, conditions.now)}).
            <button class="link" onclick={() => conditions.refresh(true)}>Refresh</button>
          {/if}
        </div>

        {#if ranking.windowPassed && settings.dayOffset === 0}
          <p class="note small">Today’s window has passed in some areas; their verdicts show what was forecast.</p>
        {/if}

        <ResultsList onSelect={select} onHover={hover} />

        <p class="safety small muted">
          A guide, not a safety service. Check the
          <a href="https://www.metoffice.gov.uk/weather/specialist-forecasts/mountain" target="_blank" rel="noopener">Met Office mountain forecast</a>
          and <a href="https://www.mwis.org.uk/" target="_blank" rel="noopener">MWIS</a> before you go.
        </p>
      </div>
    </aside>
  {:else}
    <button class="panel-tab" onclick={() => (panelOpen = true)} aria-label="Show where to go">
      <span class="tab-title">Where to go</span>
      <span class="tab-sub small">{profileLabel}, {dayLabel(settings.dayOffset).toLowerCase()}</span>
      {#if best && bestName}
        <span class="tab-best"><VerdictMark verdict={best.result.verdict} /> {bestName}</span>
      {:else if conditions.loading}
        <span class="tab-sub small">Fetching forecasts…</span>
      {/if}
    </button>
  {/if}
</div>

<style>
  .map-page {
    position: relative;
    height: calc(100dvh - 57px);
    min-height: 420px;
    overflow: hidden;
  }
  .map {
    position: absolute;
    inset: 0;
  }

  .panel {
    position: absolute;
    z-index: 3;
    top: 12px;
    right: 12px;
    bottom: 36px;
    width: 390px;
    display: flex;
    flex-direction: column;
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 12px;
    box-shadow: 0 6px 24px rgb(20 29 36 / 0.16);
    overflow: hidden;
  }
  .panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px 10px;
    border-bottom: 1px solid var(--line);
  }
  .panel-head h1 {
    font-size: 1.25rem;
    font-stretch: 75%;
  }
  .hide {
    border: 1px solid var(--line);
    background: var(--surface);
    border-radius: 6px;
    padding: 4px 10px;
    font-size: 0.85rem;
  }
  .panel-body {
    flex: 1;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 14px 16px 18px;
    display: grid;
    align-content: start;
    gap: 14px;
  }
  /* Denser chips in the panel, so the results start higher up. */
  .panel :global(.chip) {
    padding: 4px 10px;
    font-size: 0.84rem;
  }
  .panel :global(.chips) {
    gap: 5px;
  }
  .status {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
    align-items: baseline;
  }
  .error {
    color: var(--no);
  }
  .link {
    border: none;
    background: none;
    padding: 0;
    text-decoration: underline;
    color: inherit;
    font-size: inherit;
  }
  .note {
    border-left: 3px solid var(--gold);
    padding-left: 10px;
  }
  .safety {
    padding-top: 10px;
    border-top: 1px solid var(--line);
  }

  .panel-tab {
    position: absolute;
    z-index: 3;
    top: 12px;
    right: 12px;
    display: grid;
    justify-items: start;
    gap: 2px;
    text-align: left;
    max-width: 260px;
    padding: 10px 14px;
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 12px;
    box-shadow: 0 6px 24px rgb(20 29 36 / 0.16);
  }
  .tab-title {
    font-weight: 750;
    font-stretch: 75%;
    font-size: 1.1rem;
  }
  .tab-sub {
    color: var(--ink-soft);
  }
  .tab-best {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
    font-weight: 650;
    font-stretch: 85%;
  }

  .legend {
    position: absolute;
    z-index: 2;
    left: 12px;
    bottom: 28px;
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    background: color-mix(in srgb, var(--paper) 92%, transparent);
    padding: 6px 10px;
    border-radius: 8px;
    border: 1px solid var(--line);
  }
  .legend i {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    margin-right: 5px;
    vertical-align: -1px;
  }
  .legend .start-dot {
    background: #1b2731;
    box-shadow: 0 0 0 2px #fff inset;
  }
  .pick-banner,
  .map-error {
    position: absolute;
    z-index: 4;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 10px;
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 8px 12px;
    box-shadow: 0 6px 24px rgb(20 29 36 / 0.16);
  }
  .map-error {
    border-color: var(--no);
    max-width: min(90vw, 520px);
  }

  /* Phones: the panel becomes a drawer from the bottom. */
  @media (max-width: 640px) {
    .panel {
      top: auto;
      left: 0;
      right: 0;
      bottom: 0;
      width: auto;
      height: 72dvh;
      border-radius: 14px 14px 0 0;
      border-bottom: none;
    }
    .panel-tab {
      top: auto;
      left: 12px;
      right: 12px;
      bottom: 16px;
      max-width: none;
    }
    .legend {
      top: 12px;
      bottom: auto;
      left: auto;
      right: 12px;
    }
  }
</style>
