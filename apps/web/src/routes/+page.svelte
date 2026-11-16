<script lang="ts">
  import { onMount } from 'svelte';
  import { version } from '$app/env';
  import { goto } from '$app/navigation';
  import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import { conditions } from '#lib/conditions.svelte.ts';
  import { settings } from '#lib/settings.svelte.ts';
  import { ageLabel, dayLabel, formatTime } from '#lib/time.ts';
  import Controls from '#lib/components/Controls.svelte';
  import PlaceSearch from '#lib/components/PlaceSearch.svelte';
  import SkyTimeline, { type KeyMark } from '#lib/components/SkyTimeline.svelte';
  import { page } from '$app/state';
  import { skyPositions, sunTimes } from '#lib/sun.ts';
  import { londonMidnight } from '#lib/time.ts';
  import type { StartPoint } from '#lib/settings.svelte.ts';
  import ResultsList, { type Pick } from '#lib/components/ResultsList.svelte';
  import VerdictMark from '#lib/components/VerdictMark.svelte';

  const PANEL_KEY = 'atmos.panelOpen';
  const VERDICT_COLOURS = { go: '#2f7a50', maybe: '#b98318', no: '#a3412b', nodata: '#8a979f' };
  const RANK = { go: 3, maybe: 2, no: 1, nodata: 0 } as const;
  const empty = { type: 'FeatureCollection' as const, features: [] };
  const UK_BOUNDS: [[number, number], [number, number]] = [
    [-8.2, 49.9],
    [1.8, 60.9],
  ];

  let container: HTMLDivElement;
  let map: MapLibreMap | null = $state(null);
  let loaded = $state(false);
  let mapError = $state<string | null>(null);
  let picking = $state(false);
  let panelOpen = $state(true);
  let narrow = $state(false);

  const ranking = $derived(conditions.ranking);
  const best = $derived(ranking.go[0] ?? null);
  const bestName = $derived(best?.hill.name ?? null);

  const features = $derived(
    [...ranking.hillsByNumber.values()].map((h) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [h.hill.lon, h.hill.lat] },
      properties: {
        kind: 'hill',
        id: h.hill.number,
        name: h.hill.name,
        verdict: h.verdict,
        // Better hills draw on top; those needing an earlier start sit back.
        rank: RANK[h.verdict] * 100 + Math.round((h.score ?? 0) * 99) - (h.needsEarlier ? 150 : 0),
        out: h.needsEarlier ? 1 : 0,
      },
    })),
  );

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
    const sky = skyOpen && !narrow ? skyHeight + 16 : 0;
    if (!panelOpen) return { top: 60, bottom: 20 + sky, left: 20, right: 20 };
    return narrow
      ? { top: 60, bottom: Math.round(window.innerHeight * 0.55), left: 20, right: 20 }
      : { top: 60, bottom: 20 + sky, left: 20, right: 420 };
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

  // The sun and moon timeline.
  const SKY_KEY = 'atmos.skyOpen';
  let skyOpen = $state(true);
  let skyHeight = $state(0);
  let skyTime = $state(Date.now());
  const selectedHill = $derived.by(() => {
    const n = Number(page.url.searchParams.get('hill'));
    return (n && ranking.hillsByNumber.get(n)) || best;
  });
  const skyPlace = $derived(
    selectedHill
      ? { lat: selectedHill.hill.lat, lon: selectedHill.hill.lon, name: selectedHill.hill.name }
      : { lat: 56.8, lon: -4.2, name: 'the Highlands' },
  );
  const skyDayStart = $derived(londonMidnight(settings.dayOffset, conditions.now));
  const skySun = $derived(sunTimes(skyPlace.lat, skyPlace.lon, settings.dayOffset, conditions.now));
  const keyTimeOf = (r: { byModel: { model: string; keyHour: { time: number } | null }[]; referenceModel: string | null }) =>
    r.byModel.find((m) => m.model === r.referenceModel)?.keyHour?.time ?? null;
  const skyMarks = $derived.by((): KeyMark[] => {
    if (!selectedHill) return [];
    return selectedHill.counted
      .slice(0, 6)
      .map((c) => ({ time: keyTimeOf(c.result) ?? 0, label: conditions.short(c.profileId), verdict: c.result.verdict }))
      .filter((m) => m.time >= skyDayStart && m.time <= skyDayStart + 86_400_000);
  });
  // Jump to the headline condition's best hour when the hill or day changes.
  $effect(() => {
    const h = selectedHill;
    const start = skyDayStart;
    const t = h?.best ? keyTimeOf(h.best.result) : null;
    skyTime = t && t >= start && t <= start + 86_400_000 ? t : (skySun.sunrise ?? start + 8 * 3_600_000);
  });

  /** Sun and moon bearing lines from the place, about 25 km long. */
  function rays(lat: number, lon: number, time: number) {
    const p = skyPositions(time, lat, lon);
    const R = 6371;
    const line = (az: number, km: number) => {
      const b = (az * Math.PI) / 180;
      const d = km / R;
      const φ1 = (lat * Math.PI) / 180;
      const λ1 = (lon * Math.PI) / 180;
      const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(b));
      const λ2 = λ1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
      return [
        [lon, lat],
        [(λ2 * 180) / Math.PI, (φ2 * 180) / Math.PI],
      ];
    };
    return {
      type: 'FeatureCollection' as const,
      features: [
        { body: 'moon', ...p.moon },
        { body: 'sun', ...p.sun },
      ].map((b) => ({
        type: 'Feature' as const,
        geometry: { type: 'LineString' as const, coordinates: line(b.azDeg, 25) },
        properties: { body: b.body, up: b.altDeg >= 0 ? 1 : 0 },
      })),
    };
  }

  /** A place picked in the search box, offered as a start point. */
  let found = $state<StartPoint | null>(null);

  function flyTo(lat: number, lon: number, zoom: number) {
    map?.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), zoom), padding: mapPadding(), speed: 1.4 });
  }
  function onSearchHill(h: { number: number; lat: number; lon: number }) {
    found = null;
    select({ lat: h.lat, lon: h.lon, href: `?hill=${h.number}`, zoom: 11 });
  }
  function onSearchPlace(p: StartPoint) {
    found = p;
    setSource('found', point(p.lat, p.lon));
    flyTo(p.lat, p.lon, 10);
  }

  function hover(p: { lat: number; lon: number } | null) {
    setSource('highlight', p ? point(p.lat, p.lon) : empty);
  }

  onMount(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    narrow = mq.matches;
    const saved = localStorage.getItem(PANEL_KEY);
    panelOpen = saved === null ? !narrow : saved === '1';
    const sky = localStorage.getItem(SKY_KEY);
    skyOpen = sky === null ? !narrow : sky === '1';
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
      // The worker's file name only changes when MapLibre does, and immutable assets are
      // cached for a year. A per-build query string means a browser that once cached a bad
      // copy (served with the wrong MIME type before the nginx fix) fetches it afresh.
      maplibre.setWorkerUrl(`${worker.default}?v=${encodeURIComponent(version)}`);
      const m = new maplibre.Map({
        container,
        style: 'https://tiles.openfreemap.org/styles/liberty',
        // Roughly the UK; fitted properly once the panel padding is known (see 'load').
        center: [-3.4, 55.2],
        zoom: 4.6,
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
        // Set the panel padding first, then fit the UK inside what's left. Fitting with
        // padding and then easing to the same padding offset the map twice.
        m.setPadding(mapPadding());
        m.fitBounds(UK_BOUNDS, { padding: 24, animate: false });
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
        m.addSource('found', { type: 'geojson', data: empty });
        m.addSource('rays', { type: 'geojson', data: empty });
        m.addLayer({
          id: 'rays',
          type: 'line',
          source: 'rays',
          layout: { 'line-cap': 'round' },
          paint: {
            'line-color': ['match', ['get', 'body'], 'sun', '#d9a13b', '#6d7a88'],
            'line-width': ['match', ['get', 'body'], 'sun', 3, 2],
            'line-opacity': ['case', ['==', ['get', 'up'], 1], 0.95, 0.35],
            'line-dasharray': [2, 1.5],
          },
        });
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
            // Out of reach (too early) and NO both fade back.
            'circle-opacity': ['case', ['==', ['get', 'out'], 1], 0.4, ['==', ['get', 'verdict'], 'no'], 0.55, 0.95],
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
          id: 'found',
          type: 'circle',
          source: 'found',
          paint: {
            'circle-radius': 7,
            'circle-color': 'rgba(0,0,0,0)',
            'circle-stroke-color': '#1b2731',
            'circle-stroke-width': 2.5,
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
          goto(`?hill=${p.id}`, { reset: false });
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

  $effect(() => {
    const data = skyOpen ? rays(skyPlace.lat, skyPlace.lon, skyTime) : empty;
    if (map && loaded) setSource('rays', data);
  });

  $effect(() => {
    try {
      localStorage.setItem(SKY_KEY, skyOpen ? '1' : '0');
    } catch {
      // Not saved: fine.
    }
  });

  // Re-centre the visible part of the map when the panel opens, closes or changes shape.
  $effect(() => {
    void panelOpen;
    void narrow;
    void skyOpen;
    void skyHeight;
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

<svelte:head><title>Atmos: {dayLabel(settings.dayOffset).toLowerCase()}</title></svelte:head>

<div class="map-page">
  <div class="map" bind:this={container} role="region" aria-label="Map of hills coloured by verdict"></div>

  <div class="search-box">
    <PlaceSearch onHill={onSearchHill} onPlace={onSearchPlace} />
    {#if found}
      <div class="found small">
        <span>{found.label}</span>
        <button class="link" onclick={() => { settings.start = { ...found! }; found = null; setSource('found', empty); }}>Start from here</button>
        <button class="link" onclick={() => { found = null; setSource('found', empty); }} aria-label="Dismiss">Close</button>
      </div>
    {/if}
  </div>

  {#if mapError}
    <p class="map-error small" role="alert">{mapError} Results are still in the panel.</p>
  {/if}

  {#if picking}
    <div class="pick-banner small" role="status">
      Click the map where you’re starting from.
      <button class="button quiet" onclick={() => (picking = false)}>Cancel</button>
    </div>
  {/if}

  <div class="bottom" class:with-panel={panelOpen && !narrow}>
    {#if skyOpen}
      <div bind:clientHeight={skyHeight}>
        <SkyTimeline
          lat={skyPlace.lat}
          lon={skyPlace.lon}
          place={skyPlace.name}
          dayStart={skyDayStart}
          sun={skySun}
          marks={skyMarks}
          bind:time={skyTime}
        />
      </div>
    {/if}
    <div class="legend small">
      <span aria-hidden="true"><i style="background: var(--go)"></i>Go</span>
      <span aria-hidden="true"><i style="background: var(--maybe)"></i>Maybe</span>
      <span aria-hidden="true"><i style="background: var(--no)"></i>No</span>
      {#if settings.start}<span aria-hidden="true"><i class="start-dot"></i>Start</span>{/if}
      {#if skyOpen}<span aria-hidden="true"><i class="ray sun"></i>Sun</span><span aria-hidden="true"><i class="ray moon"></i>Moon</span>{/if}
      <button class="link" onclick={() => (skyOpen = !skyOpen)} aria-pressed={skyOpen}>
        {skyOpen ? 'Hide sun and moon' : 'Sun and moon'}
      </button>
    </div>
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
      <span class="tab-sub small">{dayLabel(settings.dayOffset)}, {conditions.ticked.size} conditions</span>
      {#if best && bestName}
        <span class="tab-best"><VerdictMark verdict={best.verdict} /> {bestName}</span>
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

  .search-box {
    position: absolute;
    z-index: 4;
    top: 12px;
    left: 12px;
    display: grid;
    gap: 6px;
    justify-items: start;
  }
  .found {
    display: flex;
    gap: 12px;
    align-items: baseline;
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 5px 10px;
    box-shadow: 0 4px 16px rgb(20 29 36 / 0.14);
  }
  .map-page :global(.maplibregl-ctrl-top-left) {
    top: 56px;
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

  .bottom {
    position: absolute;
    z-index: 2;
    left: 12px;
    right: 12px;
    bottom: 26px;
    display: grid;
    gap: 6px;
    justify-items: start;
    pointer-events: none;
  }
  .bottom > * {
    pointer-events: auto;
  }
  .bottom > div:first-child {
    justify-self: stretch;
  }
  .bottom.with-panel {
    right: 414px;
  }
  .legend .ray {
    width: 14px;
    height: 0;
    border-radius: 0;
    border-top: 3px dashed #d9a13b;
    vertical-align: 3px;
  }
  .legend .ray.moon {
    border-top: 2px dashed #6d7a88;
  }
  .legend {
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
    .bottom {
      top: 60px;
      bottom: auto;
    }
    /* Pinch to zoom on phones; the buttons would sit under the legend. */
    .map-page :global(.maplibregl-ctrl-top-left) {
      display: none;
    }
    .search-box {
      right: 12px;
    }
  }
</style>
