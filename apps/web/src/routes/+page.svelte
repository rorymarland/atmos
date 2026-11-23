<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { version } from '$app/env';
  import { goto } from '$app/navigation';
  import type { ExpressionSpecification, GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import { conditions } from '#lib/conditions.svelte.ts';
  import { alignment } from '#lib/alignment.svelte.ts';
  import { settings } from '#lib/settings.svelte.ts';
  import { ageLabel, dayLabel, formatTime } from '#lib/time.ts';
  import Controls from '#lib/components/Controls.svelte';
  import DetailSheet from '#lib/components/DetailSheet.svelte';
  import PlaceSearch from '#lib/components/PlaceSearch.svelte';
  import SkyTimeline, { type KeyMark } from '#lib/components/SkyTimeline.svelte';
  import PanoramaStrip from '#lib/components/PanoramaStrip.svelte';
  import { viewer } from '#lib/panorama.svelte.ts';
  import { page } from '$app/state';
  import { moonTimes, skyPositions, sunTimes } from '#lib/sun.ts';
  import { londonMidnight } from '#lib/time.ts';
  import { filtersChanged, resetFilters, type StartPoint } from '#lib/settings.svelte.ts';
  import { loadSearchHills } from '#lib/static-data.ts';
  import { bodyAt, destination, isCustomNumber, waterAsPlace, waterIndexOf } from '@atmos/engine';
  import type { Hill } from '@atmos/engine';
  import ResultsList, { type Pick } from '#lib/components/ResultsList.svelte';
  import VerdictMark from '#lib/components/VerdictMark.svelte';
  import Quiz from '#lib/components/Quiz.svelte';
  import PlaceEditor from '#lib/components/PlaceEditor.svelte';
  import { places } from '#lib/places.svelte.ts';

  const PANEL_KEY = 'atmos.panelOpen';
  const VERDICT_COLOURS = { go: '#2f7a50', maybe: '#b98318', no: '#a3412b', nodata: '#8a979f' };
  const RANK = { go: 3, maybe: 2, no: 1, nodata: 0 } as const;
  const empty = { type: 'FeatureCollection' as const, features: [] };
  /** Rings for the best bet and hovered hills. */
  const RING_BLUE = '#1d6fe0';
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
  /** Phones: the colour key folds away behind a "Key" button. */
  let keyOpen = $state(false);

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
        custom: h.hill.kind === 'custom' ? 1 : 0,
      },
    })),
  );

  function point(lat: number, lon: number) {
    return {
      type: 'FeatureCollection' as const,
      features: [{ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [lon, lat] }, properties: {} }],
    };
  }

  function basemapStyle(theme: 'light' | 'dark') {
    return `https://tiles.openfreemap.org/styles/${theme === 'dark' ? 'dark' : 'liberty'}`;
  }

  /**
   * OpenFreeMap's Dark has land almost black (12,12,12) and water barely different (27,27,29),
   * lighter than the land. Lift the land to a dark slate in Atmos's own dark palette, sink the
   * water below it with a little blue so coasts and lochs read, and give woods, parks, roads
   * and borders just enough to see. Still a dark map.
   */
  const DARK_LIFT: Record<string, Record<string, string>> = {
    background: { 'background-color': '#1b252d' },
    water: { 'fill-color': '#0b1621' },
    waterway: { 'line-color': '#0e1b27' },
    landcover_ice_shelf: { 'fill-color': '#26313a' },
    landcover_glacier: { 'fill-color': '#26313a' },
    landuse_residential: { 'fill-color': '#252e36' },
    landcover_wood: { 'fill-color': '#1d2b25' },
    landuse_park: { 'fill-color': '#1f2c27' },
    building: { 'fill-color': '#202a32', 'fill-outline-color': '#2c3842' },
    'aeroway-area': { 'fill-color': '#202930' },
    highway_path: { 'line-color': '#34404a' },
    highway_minor: { 'line-color': '#2a353e' },
    highway_major_inner: { 'line-color': '#34414b' },
    highway_major_subtle: { 'line-color': '#2e3a43' },
    highway_motorway_subtle: { 'line-color': '#2e3a43' },
    boundary_state: { 'line-color': '#4d5c68' },
    'boundary_country_z0-4': { 'line-color': '#5a6a77' },
    'boundary_country_z5-': { 'line-color': '#5a6a77' },
  };

  /** Atmos's own colours that need to change with the basemap. */
  function applyThemePaint(m: import('maplibre-gl').Map, theme: 'light' | 'dark') {
    const dark = theme === 'dark';
    const set = (
      layer: string,
      prop: Parameters<typeof m.setPaintProperty>[1],
      value: Parameters<typeof m.setPaintProperty>[2],
    ) => {
      if (m.getLayer(layer)) m.setPaintProperty(layer, prop, value);
    };
    // The light basemap is reloaded fresh, so only the dark one needs lifting.
    if (dark) {
      for (const [layer, paint] of Object.entries(DARK_LIFT)) {
        for (const [prop, value] of Object.entries(paint)) {
          set(layer, prop as Parameters<typeof m.setPaintProperty>[1], value);
        }
      }
    }
    // A touch more relief in the dark, so the hills show against the slate.
    set('hillshade', 'hillshade-exaggeration', dark ? 0.5 : 0.35);
    set('hillshade', 'hillshade-shadow-color', dark ? '#05090c' : '#4c5b67');
    set('hillshade', 'hillshade-highlight-color', dark ? '#7f8e9b' : '#ffffff');
    set('targets', 'circle-stroke-color', ['case', ['==', ['get', 'custom'], 1], dark ? '#f2f5f7' : '#1d2830', dark ? '#1b2731' : '#ffffff']);
    set('ray-labels', 'text-color', dark
      ? ['match', ['get', 'kind'], 'sunrise', '#ffcf7a', 'sunset', '#ff9f80', 'sun', '#ffd98f', 'moonrise', '#c9d6e8', 'moonset', '#dde6f2', '#e8edf2']
      : ['match', ['get', 'kind'], 'sunrise', '#8a5a00', 'sunset', '#8f3312', 'sun', '#7a5200', 'moonrise', '#3d4b5e', 'moonset', '#1f2a38', '#2c3846']);
    set('ray-labels', 'text-halo-color', dark ? '#10161c' : '#ffffff');
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
    // The hill opens in the panel: bring it back once the map has moved.
    if (!panelOpen) setTimeout(() => (panelOpen = true), narrow ? 900 : 0);
  }

  const hillOpen = $derived(page.url.searchParams.has('hill'));

  /** Reset the search and close any open hill. */
  function resetAll() {
    resetFilters();
    pin = null;
    if (hillOpen) {
      const url = new URL(page.url.href);
      url.searchParams.delete('hill');
      goto(url, { replace: true, reset: false });
    }
  }

  let quizOpen = $state(false);
  let placeOpen = $state(false);
  /** The quiz filled in the search: show its results, not an open hill. */
  function quizDone() {
    pin = null;
    panelOpen = true;
    if (hillOpen) {
      const url = new URL(page.url.href);
      url.searchParams.delete('hill');
      goto(url, { replace: true, reset: false });
    }
  }

  // A link from an alert email names the day (?date=2026-11-19): show that day, then drop
  // the date from the address so it doesn't stick.
  $effect(() => {
    const date = page.url.searchParams.get('date');
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    untrack(() => {
      const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' });
      for (let d = 0; d < 5; d++) {
        if (fmt.format(londonMidnight(d) + 12 * 3_600_000) === date) settings.dayOffset = d;
      }
      const url = new URL(page.url.href);
      url.searchParams.delete('date');
      goto(url, { replace: true, reset: false });
    });
  });

  // A link or reload straight to a hill that isn't on the lists: find it in the search data.
  $effect(() => {
    const n = Number(page.url.searchParams.get('hill'));
    const data = conditions.data;
    if (!n || !data || data.hillsByNumber.has(n) || conditions.extra?.number === n) return;
    const w = waterIndexOf(n);
    if (w !== null) {
      const body = data.waters?.[w];
      if (body) conditions.extra = waterAsPlace(body, w);
      return;
    }
    void loadSearchHills().then((others) => {
      const h = others.find((x) => x.number === n);
      if (h) conditions.extra = h;
    });
  });
  const openHill = $derived(
    hillOpen ? ranking.hillsByNumber.get(Number(page.url.searchParams.get('hill'))) : undefined,
  );

  // Walking routes: the open hill first, then the best bet and the next two.
  $effect(() => {
    const h = openHill?.hill;
    if (h) untrack(() => conditions.requestRoute(h, true));
  });
  $effect(() => {
    const top = ranking.go.slice(0, 3).map((r) => r.hill);
    untrack(() => {
      for (const h of top) void conditions.requestRoute(h);
    });
  });
  const openRoute = $derived(
    openHill?.route && typeof openHill.route === 'object' ? openHill.route : null,
  );
  $effect(() => {
    const r = openRoute;
    const data = r
      ? {
          type: 'FeatureCollection' as const,
          features: [
            {
              type: 'Feature' as const,
              geometry: { type: 'LineString' as const, coordinates: r.path },
              properties: {},
            },
            {
              type: 'Feature' as const,
              geometry: { type: 'Point' as const, coordinates: [r.start.lon, r.start.lat] },
              properties: { label: r.start.kind === 'parking' ? 'P' : '' },
            },
          ],
        }
      : empty;
    if (map && loaded) setSource('route', data);
  });

  // Where to stand to line the sun or moon up with the open hill's summit.
  const openAlignment = $derived.by(() => {
    const a = alignment.current;
    return a && a.status === 'ready' && openHill && a.hill === openHill.hill.number && a.dayOffset === settings.dayOffset ? a : null;
  });
  $effect(() => {
    const a = openAlignment;
    const data = a
      ? {
          type: 'FeatureCollection' as const,
          features: a.points.map((p) => ({
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
            // A time label every ten minutes; the rest are just dots.
            properties: { body: a.body, label: Math.round(p.time / 60_000) % 10 === 0 ? formatTime(p.time) : '' },
          })),
        }
      : empty;
    if (map && loaded) setSource('alignment', data);
  });

  // The sun and moon timeline.
  const SKY_KEY = 'atmos.skyOpen';
  let skyOpen = $state(true);
  let skyHeight = $state(0);
  let skyTime = $state(Date.now());
  const selectedHill = $derived.by(() => {
    const n = Number(page.url.searchParams.get('hill'));
    return (n && ranking.hillsByNumber.get(n)) || best;
  });
  /** Where the sun and moon lines start: a pin you drag, else the selected hill. */
  let pin = $state<{ lat: number; lon: number; name: string } | null>(null);
  // Selecting another hill brings the pin back to it.
  $effect(() => {
    void page.url.searchParams.get('hill');
    pin = null;
  });
  const skyPlace = $derived(
    pin ??
      (selectedHill
        ? { lat: selectedHill.hill.lat, lon: selectedHill.hill.lon, name: selectedHill.hill.name }
        : { lat: 56.8, lon: -4.2, name: 'the Highlands' }),
  );
  let mapZoom = $state(6);
  let pinMarker: import('maplibre-gl').Marker | null = null;

  /** Name a dropped pin after the nearest hill within 3 km, if there is one. */
  function pinName(lat: number, lon: number): string {
    let bestName: string | null = null;
    let bestD = 3;
    for (const h of conditions.data?.hills ?? []) {
      const dLat = (h.lat - lat) * 111;
      const dLon = (h.lon - lon) * 111 * Math.cos((lat * Math.PI) / 180);
      const d = Math.hypot(dLat, dLon);
      if (d < bestD) {
        bestD = d;
        bestName = h.name;
      }
    }
    return bestName ? `the pin near ${bestName}` : 'the pin';
  }
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

  // The viewer: the view from the pin, or from the summit when the pin is on an open hill.
  const viewShown = $derived(hillOpen || pin !== null);
  const viewEyeM = $derived(pin === null && selectedHill ? selectedHill.hill.metres + 1.7 : undefined);
  let viewTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const p = skyPlace;
    const eye = viewEyeM;
    const hills = conditions.data?.hills;
    if (!viewer.open || !viewShown || !hills) return;
    // Wait for the pin to settle: dragging it would otherwise ask for a view at every step.
    clearTimeout(viewTimer);
    viewTimer = setTimeout(
      () => viewer.request(p.lat, p.lon, eye, hills.map((h) => ({ id: h.number, name: h.name, lat: h.lat, lon: h.lon, metres: h.metres }))),
      350,
    );
  });
  // A new hill: face the sun at the timeline's time (or the moon, if the sun's down). Keyed on
  // the hill's number, so fresh forecasts (a new ranking object) don't turn the view back.
  const selectedNumber = $derived(selectedHill?.hill.number);
  $effect(() => {
    if (selectedNumber === undefined) return;
    untrack(() => {
      const h = selectedHill?.hill;
      if (!h) return;
      // A view set up on this hill before comes back as it was.
      const kept = viewer.remembered(h.number);
      if (kept) {
        viewer.heading = kept.heading;
        viewer.lens = kept.lens;
        return;
      }
      const sun = bodyAt('sun', skyTime, h.lat, h.lon);
      const moon = bodyAt('moon', skyTime, h.lat, h.lon);
      viewer.heading = sun.alt > -2 || moon.alt < 0 ? sun.az : moon.az;
    });
  });
  // Remember the view on this hill once turning or changing lens settles.
  let rememberTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    void [viewer.heading, viewer.lens];
    const n = pin === null ? selectedNumber : undefined;
    if (n === undefined) return;
    clearTimeout(rememberTimer);
    rememberTimer = setTimeout(() => viewer.remember(n), 800);
  });

  // A one-time pointer to the Help page for first visits.
  const HELP_SEEN = 'atmos.helpSeen';
  let showHelpNudge = $state(false);
  $effect(() => {
    try {
      showHelpNudge = !localStorage.getItem(HELP_SEEN);
    } catch {
      showHelpNudge = false;
    }
  });
  function dismissHelpNudge() {
    showHelpNudge = false;
    try {
      localStorage.setItem(HELP_SEEN, '1');
    } catch {
      // Without storage it may show again next time; harmless.
    }
  }

  function openHillNumber(n: number) {
    goto(`?hill=${n}`, { reset: false });
  }

  /**
   * Bearing lines from the pin: where the sun and moon rise and set today, and where they
   * are at the timeline's time. The lines run off the edge of the map; each label sits a
   * set distance along its line, so they stay put and readable at any zoom.
   */
  function rays(lat: number, lon: number, time: number, zoom: number, withNow = true) {
    const metresPerPixel = (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
    const km = (pixels: number) => Math.min(800, (pixels * metresPerPixel) / 1000);
    const R = 6371;
    const end = (az: number, pixels: number) => {
      const b = (az * Math.PI) / 180;
      const d = km(pixels) / R;
      const φ1 = (lat * Math.PI) / 180;
      const λ1 = (lon * Math.PI) / 180;
      const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(b));
      const λ2 = λ1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
      return [(λ2 * 180) / Math.PI, (φ2 * 180) / Math.PI];
    };
    const sun = sunTimes(lat, lon, settings.dayOffset, conditions.now);
    const moon = moonTimes(lat, lon, skyDayStart);
    const now = skyPositions(time, lat, lon);
    const at = (t: number) => skyPositions(t, lat, lon);
    const lines: { kind: string; label: string; az: number; up: boolean }[] = [];
    if (moon.rise) lines.push({ kind: 'moonrise', label: `Moonrise ${formatTime(moon.rise)}`, az: at(moon.rise).moon.azDeg, up: true });
    if (moon.set) lines.push({ kind: 'moonset', label: `Moonset ${formatTime(moon.set)}`, az: at(moon.set).moon.azDeg, up: true });
    if (sun.sunrise) lines.push({ kind: 'sunrise', label: `Sunrise ${formatTime(sun.sunrise)}`, az: at(sun.sunrise).sun.azDeg, up: true });
    if (sun.sunset) lines.push({ kind: 'sunset', label: `Sunset ${formatTime(sun.sunset)}`, az: at(sun.sunset).sun.azDeg, up: true });
    // The current sun and moon follow the timeline, so they only show while it's open.
    if (withNow) {
      lines.push({ kind: 'moon', label: `Moon ${formatTime(time)}`, az: now.moon.azDeg, up: now.moon.altDeg >= 0 });
      lines.push({ kind: 'sun', label: `Sun ${formatTime(time)}`, az: now.sun.azDeg, up: now.sun.altDeg >= 0 });
    }
    return {
      type: 'FeatureCollection' as const,
      features: lines.flatMap((l) => {
        // Labels for now sit further out than the rise and set ones, so they don't collide.
        const labelAt = l.kind === 'sun' || l.kind === 'moon' ? 300 : 210;
        const props = { kind: l.kind, label: l.label, up: l.up ? 1 : 0 };
        return [
          {
            type: 'Feature' as const,
            geometry: { type: 'LineString' as const, coordinates: [[lon, lat], end(l.az, 2000)] },
            properties: props,
          },
          {
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: end(l.az, labelAt) },
            properties: props,
          },
        ];
      }),
    };
  }

  /** A place picked in the search box, offered as a start point. */
  let found = $state<StartPoint | null>(null);

  function flyTo(lat: number, lon: number, zoom: number) {
    map?.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), zoom), padding: mapPadding(), speed: 1.4 });
  }
  function onSearchHill(h: { number: number; lat: number; lon: number; other?: Hill }) {
    found = null;
    // Not on the lists: score it on its own, without adding it to the map or results.
    if (h.other) conditions.extra = h.other;
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
        style: basemapStyle(settings.theme),
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
        // Everything in the style so far is the basemap; what's added below is Atmos's own,
        // carried across when the theme swaps the basemap.
        baseSources = new Set(Object.keys(m.getStyle().sources));
        baseLayers = new Set(m.getStyle().layers.map((l) => l.id));
        styleTheme = settings.theme;
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
        // Aurora: the OVATION nowcast as 1° cells (the model's own resolution), and the
        // chosen night's view line from the Kp forecast. Under the hill points.
        m.addSource('aurora-cells', { type: 'geojson', data: empty });
        m.addSource('aurora-line', { type: 'geojson', data: empty });
        m.addLayer(
          {
            id: 'aurora-cells',
            type: 'fill',
            source: 'aurora-cells',
            paint: {
              'fill-color': [
                'interpolate', ['linear'], ['get', 'chance'],
                3, 'rgba(46,170,98,0.12)',
                10, 'rgba(46,170,98,0.28)',
                30, 'rgba(120,200,60,0.36)',
                50, 'rgba(240,205,50,0.42)',
                80, 'rgba(226,96,58,0.48)',
              ],
              'fill-outline-color': 'rgba(0,0,0,0)',
            },
          },
          firstSymbol,
        );
        m.addLayer({
          id: 'aurora-line',
          type: 'line',
          source: 'aurora-line',
          filter: ['==', ['geometry-type'], 'LineString'],
          paint: { 'line-color': '#2f9e5b', 'line-width': 3, 'line-dasharray': [3, 2] },
        });
        m.addSource('targets', { type: 'geojson', data: empty });
        m.addSource('highlight', { type: 'geojson', data: empty });
        m.addSource('start', { type: 'geojson', data: empty });
        m.addSource('found', { type: 'geojson', data: empty });
        m.addSource('rays', { type: 'geojson', data: empty });
        const RAY_COLOUR = [
          'match', ['get', 'kind'],
          'sunrise', '#e3a22e',
          'sunset', '#c4502a',
          'sun', '#d9a13b',
          'moonrise', '#7f8fa3',
          'moonset', '#46546a',
          '#6d7a88',
        ] as unknown as string;
        const isNow: ExpressionSpecification = ['in', ['get', 'kind'], ['literal', ['sun', 'moon']]];
        // Rise and set: solid lines, fixed for the day.
        m.addLayer({
          id: 'rays-day',
          type: 'line',
          source: 'rays',
          filter: ['all', ['==', ['geometry-type'], 'LineString'], ['!', isNow]],
          layout: { 'line-cap': 'round' },
          paint: { 'line-color': RAY_COLOUR, 'line-width': 2.5, 'line-opacity': 0.9 },
        });
        // Now, from the timeline: thicker and dashed; faint when below the horizon.
        m.addLayer({
          id: 'rays-now',
          type: 'line',
          source: 'rays',
          filter: ['all', ['==', ['geometry-type'], 'LineString'], isNow],
          layout: { 'line-cap': 'round' },
          paint: {
            'line-color': RAY_COLOUR,
            'line-width': 4,
            'line-opacity': ['case', ['==', ['get', 'up'], 1], 1, 0.35],
            'line-dasharray': [1.6, 1.2],
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
              5, ['case', ['==', ['get', 'kind'], 'zone'], 8, ['==', ['get', 'custom'], 1], 5, 3.5],
              9, ['case', ['==', ['get', 'kind'], 'zone'], 12, ['==', ['get', 'custom'], 1], 9, 7],
            ],
            'circle-color': [
              'match', ['get', 'verdict'],
              'go', VERDICT_COLOURS.go,
              'maybe', VERDICT_COLOURS.maybe,
              'no', VERDICT_COLOURS.no,
              VERDICT_COLOURS.nodata,
            ],
            // Custom places: bigger, with a dark ring, so your own spots stand out.
            'circle-stroke-color': ['case', ['==', ['get', 'custom'], 1], '#1d2830', '#ffffff'],
            'circle-stroke-width': ['case', ['==', ['get', 'custom'], 1], 2.5, 1],
            // Out of reach (too early) and NO both fade back.
            'circle-opacity': ['case', ['==', ['get', 'out'], 1], 0.4, ['==', ['get', 'verdict'], 'no'], 0.55, 0.95],
          },
        });
        // The best bet (always) and whatever's hovered in the list: a bright blue ring on a
        // white halo, which stands out from the green, amber and red points and the map.
        // The viewer's wedge, under everything else that's drawn from the pin.
        m.addSource('view', { type: 'geojson', data: empty });
        m.addLayer({
          id: 'view-fill',
          type: 'fill',
          source: 'view',
          paint: { 'fill-color': '#2f6fb3', 'fill-opacity': 0.12 },
        });
        m.addLayer({
          id: 'view-edge',
          type: 'line',
          source: 'view',
          paint: { 'line-color': '#2f6fb3', 'line-width': 1.5, 'line-opacity': 0.7 },
        });
        const handle = document.createElement('div');
        handle.className = 'view-handle';
        handle.title = 'Drag to turn the view';
        viewHandle = new maplibre.Marker({ element: handle, draggable: true });
        viewHandle.on('dragstart', () => (viewHandleDragging = true));
        viewHandle.on('drag', () => {
          const ll = viewHandle!.getLngLat();
          const φ1 = (skyPlace.lat * Math.PI) / 180;
          const φ2 = (ll.lat * Math.PI) / 180;
          const Δ = ((ll.lng - skyPlace.lon) * Math.PI) / 180;
          const θ = Math.atan2(Math.sin(Δ) * Math.cos(φ2), Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δ));
          viewer.heading = ((θ * 180) / Math.PI + 360) % 360;
        });
        // Letting go puts the handle back on the wedge's edge.
        viewHandle.on('dragend', () => (viewHandleDragging = false));

        // Where to stand for the sun or moon on the summit: small dots, a time every ten minutes.
        m.addSource('alignment', { type: 'geojson', data: empty });
        m.addLayer({
          id: 'alignment-dots',
          type: 'circle',
          source: 'alignment',
          paint: {
            'circle-radius': 3.5,
            'circle-color': ['match', ['get', 'body'], 'moon', '#5a6fd0', '#e08a1e'],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 1,
          },
        });
        try {
          m.addLayer({
            id: 'alignment-times',
            type: 'symbol',
            source: 'alignment',
            filter: ['!=', ['get', 'label'], ''],
            layout: {
              'text-field': ['get', 'label'],
              'text-font': ['Noto Sans Bold'],
              'text-size': 11,
              'text-offset': [0, -1.1],
            },
            paint: { 'text-color': '#2a2a2a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
          });
        } catch (e) {
          console.warn('Alignment labels unavailable', e);
        }
        // The open hill's walking route: a purple line on a white casing, and its start.
        m.addSource('route', { type: 'geojson', data: empty });
        m.addLayer({
          id: 'route-casing',
          type: 'line',
          source: 'route',
          filter: ['==', ['geometry-type'], 'LineString'],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#ffffff', 'line-width': 7 },
        });
        m.addLayer({
          id: 'route-line',
          type: 'line',
          source: 'route',
          filter: ['==', ['geometry-type'], 'LineString'],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#7b3fa8', 'line-width': 4 },
        });
        m.addLayer({
          id: 'route-start',
          type: 'circle',
          source: 'route',
          filter: ['==', ['geometry-type'], 'Point'],
          paint: {
            'circle-radius': 9,
            'circle-color': '#1f4fa0',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
          },
        });
        try {
          m.addLayer({
            id: 'route-start-label',
            type: 'symbol',
            source: 'route',
            filter: ['==', ['geometry-type'], 'Point'],
            layout: {
              'text-field': ['get', 'label'],
              'text-font': ['Noto Sans Bold'],
              'text-size': 12,
              'text-allow-overlap': true,
            },
            paint: { 'text-color': '#ffffff' },
          });
        } catch (e) {
          console.warn('Car park label unavailable', e);
        }
        m.addSource('best', { type: 'geojson', data: empty });
        for (const id of ['best', 'highlight']) {
          m.addLayer({
            id: `${id}-halo`,
            type: 'circle',
            source: id,
            paint: {
              'circle-radius': 16,
              'circle-color': 'rgba(0,0,0,0)',
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': 7,
            },
          });
          m.addLayer({
            id,
            type: 'circle',
            source: id,
            paint: {
              'circle-radius': 16,
              'circle-color': 'rgba(29,111,224,0.12)',
              'circle-stroke-color': RING_BLUE,
              'circle-stroke-width': 3.5,
            },
          });
        }
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
        try {
          m.addLayer({
            id: 'aurora-label',
            type: 'symbol',
            source: 'aurora-line',
            filter: ['==', ['geometry-type'], 'Point'],
            layout: {
              'text-field': ['get', 'label'],
              'text-font': ['Noto Sans Bold'],
              'text-size': 13,
              'text-anchor': 'bottom-left',
              'text-max-width': 40,
              'text-offset': [0.3, -0.3],
              'text-allow-overlap': true,
            },
            paint: { 'text-color': '#1e6b3e', 'text-halo-color': '#ffffff', 'text-halo-width': 2.4 },
          });
        } catch (e) {
          console.warn('Aurora label unavailable', e);
        }
        try {
          m.addLayer({
            id: 'ray-labels',
            type: 'symbol',
            source: 'rays',
            filter: ['==', ['geometry-type'], 'Point'],
            layout: {
              'text-field': ['get', 'label'],
              'text-font': ['Noto Sans Bold'],
              'text-size': 14,
              'text-allow-overlap': true,
              'text-ignore-placement': true,
            },
            // Dark versions of the line colours on a thick white halo: legible on any map.
            paint: {
              'text-color': [
                'match', ['get', 'kind'],
                'sunrise', '#8a5a00',
                'sunset', '#8f3312',
                'sun', '#7a5200',
                'moonrise', '#3d4b5e',
                'moonset', '#1f2a38',
                '#2c3846',
              ],
              'text-halo-color': '#ffffff',
              'text-halo-width': 2.6,
            },
          });
        } catch (e) {
          console.warn('Sun and moon labels unavailable', e);
        }

        // The pin the lines start from: drag it anywhere.
        const el = document.createElement('div');
        el.className = 'sky-pin';
        el.title = 'Drag to see the sun and moon from here';
        el.innerHTML =
          '<svg viewBox="0 0 24 32" width="24" height="32" aria-hidden="true"><path d="M12 1C6 1 1.5 5.5 1.5 11.2 1.5 19 12 31 12 31s10.5-12 10.5-19.8C22.5 5.5 18 1 12 1z" fill="#1b2731" stroke="#fff" stroke-width="1.5"/><circle cx="12" cy="11" r="4.2" fill="#d9a13b"/></svg>';
        pinMarker = new maplibre.Marker({ element: el, draggable: true, anchor: 'bottom' })
          .setLngLat([skyPlace.lon, skyPlace.lat]);
        const onDrag = () => {
          const ll = pinMarker!.getLngLat();
          pin = { lat: Math.round(ll.lat * 1e4) / 1e4, lon: Math.round(ll.lng * 1e4) / 1e4, name: 'the pin' };
        };
        pinMarker.on('dragstart', () => (pinDragging = true));
        pinMarker.on('drag', onDrag);
        pinMarker.on('dragend', () => {
          pinDragging = false;
          onDrag();
          pin = { ...pin!, name: pinName(pin!.lat, pin!.lon) };
        });
        mapZoom = m.getZoom();
        m.on('zoom', () => (mapZoom = m.getZoom()));
        m.on('click', 'targets', (e) => {
          if (picking) return;
          const f = e.features?.[0];
          if (!f) return;
          const p = f.properties as { kind: string; id: string | number };
          goto(`?hill=${p.id}`, { reset: false });
          if (!narrow) panelOpen = true;
        });
        m.on('click', (e: MapMouseEvent) => {
          const lat = Math.round(e.lngLat.lat * 1e4) / 1e4;
          const lon = Math.round(e.lngLat.lng * 1e4) / 1e4;
          if (picking) {
            settings.start = { lat, lon, label: 'the point you picked' };
            picking = false;
            return;
          }
          // A click on a hill opens it (above); anywhere else moves the sun and moon pin.
          if (m.queryRenderedFeatures(e.point, { layers: ['targets'] }).length) return;
          pin = { lat, lon, name: pinName(lat, lon) };
        });
        m.on('mouseenter', 'targets', () => (m.getCanvas().style.cursor = 'pointer'));
        m.on('mouseleave', 'targets', () => (m.getCanvas().style.cursor = picking ? 'crosshair' : ''));
        applyThemePaint(m, settings.theme);
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

  // Dark mode swaps the basemap for OpenFreeMap's Dark, keeping Atmos's own sources and
  // layers (with their current data) in the same places among the basemap's layers.
  let baseSources = new Set<string>();
  let baseLayers = new Set<string>();
  let styleTheme: 'light' | 'dark' = 'light';
  $effect(() => {
    const theme = settings.theme;
    const m = map;
    if (!m || !loaded || theme === styleTheme) return;
    styleTheme = theme;
    m.setStyle(basemapStyle(theme), {
      transformStyle: (prev, next) => {
        if (!prev) return next;
        const ours = prev.layers.filter((l) => !baseLayers.has(l.id));
        const firstPrevSymbol = prev.layers.findIndex((l) => l.type === 'symbol');
        const under = ours.filter((l) => prev.layers.indexOf(l) < firstPrevSymbol);
        const over = ours.filter((l) => prev.layers.indexOf(l) >= firstPrevSymbol);
        const firstNextSymbol = next.layers.findIndex((l) => l.type === 'symbol');
        const at = firstNextSymbol < 0 ? next.layers.length : firstNextSymbol;
        const layers = [...next.layers.slice(0, at), ...under, ...next.layers.slice(at), ...over];
        const sources = { ...next.sources };
        for (const [id, src] of Object.entries(prev.sources)) if (!baseSources.has(id)) sources[id] = src;
        baseSources = new Set(Object.keys(next.sources));
        baseLayers = new Set(next.layers.map((l) => l.id));
        return { ...next, sources, layers };
      },
    });
    m.once('style.load', () => applyThemePaint(m, theme));
  });

  // Aurora layers, only while the aurora is ticked (with night).
  const showOvation = $derived(conditions.auroraShown && settings.dayOffset === 0 && conditions.ovation !== null);
  const auroraOutlook = $derived(conditions.auroraShown ? conditions.auroraOutlook : null);
  $effect(() => {
    const o = showOvation ? conditions.ovation : null;
    const data = o
      ? {
          type: 'FeatureCollection' as const,
          features: o.cells
            .filter((c) => c.chance >= 3)
            .map((c) => ({
              type: 'Feature' as const,
              geometry: {
                type: 'Polygon' as const,
                coordinates: [
                  [
                    [c.lon - 0.5, c.lat - 0.5],
                    [c.lon + 0.5, c.lat - 0.5],
                    [c.lon + 0.5, c.lat + 0.5],
                    [c.lon - 0.5, c.lat + 0.5],
                    [c.lon - 0.5, c.lat - 0.5],
                  ],
                ],
              },
              properties: { chance: c.chance },
            })),
        }
      : empty;
    if (map && loaded) setSource('aurora-cells', data);
  });
  $effect(() => {
    const a = auroraOutlook;
    const data = a
      ? {
          type: 'FeatureCollection' as const,
          features: [
            {
              type: 'Feature' as const,
              geometry: { type: 'LineString' as const, coordinates: [[-14, a.lat], [5, a.lat]] },
              properties: {},
            },
            {
              type: 'Feature' as const,
              geometry: { type: 'Point' as const, coordinates: [-10.5, a.lat] },
              properties: { label: `Aurora view line, Kp ${a.kp.toFixed(1)}: low in the north from here northwards` },
            },
          ],
        }
      : empty;
    if (map && loaded) setSource('aurora-line', data);
  });

  $effect(() => {
    const b = best;
    if (map && loaded) setSource('best', b ? point(b.hill.lat, b.hill.lon) : empty);
  });

  $effect(() => {
    const s = settings.start;
    if (map && loaded) setSource('start', s ? point(s.lat, s.lon) : empty);
  });

  $effect(() => {
    if (map) map.getCanvas().style.cursor = picking ? 'crosshair' : '';
  });

  $effect(() => {
    // Rise and set lines stay with the pin whenever it shows; the current ones need the timeline.
    const pinShown = skyOpen || hillOpen || pin !== null;
    const data = pinShown ? rays(skyPlace.lat, skyPlace.lon, skyTime, mapZoom, skyOpen) : empty;
    if (map && loaded) setSource('rays', data);
  });

  // The view wedge: which way the viewer faces and how much the lens takes in.
  $effect(() => {
    const shown = viewer.open && viewShown;
    const { lat, lon } = skyPlace;
    const metresPerPixel = (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** mapZoom);
    const km = Math.min(150, (160 * metresPerPixel) / 1000);
    const half = viewer.fov / 2;
    const edge = (az: number) => {
      const p = destination(lat, lon, az, km);
      return [p.lon, p.lat];
    };
    const arc = Array.from({ length: 13 }, (_, i) => edge(viewer.heading - half + (i * 2 * half) / 12));
    const data = shown
      ? {
          type: 'FeatureCollection' as const,
          features: [
            {
              type: 'Feature' as const,
              geometry: { type: 'Polygon' as const, coordinates: [[[lon, lat], ...arc, [lon, lat]]] },
              properties: {},
            },
          ],
        }
      : empty;
    if (map && loaded) setSource('view', data);
    // The handle at the far middle of the wedge: drag it to turn.
    if (!viewHandle || !map) return;
    if (!shown) {
      viewHandle.remove();
      viewHandleOn = false;
      return;
    }
    if (!viewHandleDragging) viewHandle.setLngLat(edge(viewer.heading) as [number, number]);
    if (!viewHandleOn) {
      viewHandle.addTo(map);
      viewHandleOn = true;
    }
  });
  let viewHandle: import('maplibre-gl').Marker | null = null;
  let viewHandleOn = false;
  let viewHandleDragging = $state(false);

  // Keep the pin on the place. It shows while the timeline is open, and also whenever a hill
  // is open or you've placed it, timeline or not. Re-adding the marker mid-drag would cut
  // the drag short, so it's added once and left alone then.
  let pinDragging = false;
  let pinOnMap = false;
  $effect(() => {
    const p = skyPlace;
    const open = skyOpen || hillOpen || pin !== null;
    if (!map || !loaded || !pinMarker) return;
    if (!open) {
      if (pinOnMap) pinMarker.remove();
      pinOnMap = false;
      return;
    }
    if (!pinDragging) pinMarker.setLngLat([p.lon, p.lat]);
    if (!pinOnMap) {
      pinMarker.addTo(map);
      pinOnMap = true;
    }
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
    <PlaceSearch onHill={onSearchHill} onPlace={onSearchPlace} keepQuery />
    {#if showHelpNudge && !hillOpen}
      <div class="found small help-nudge">
        <span>New here?</span>
        <a href="/help" onclick={dismissHelpNudge}>See how Atmos works</a>
        <button class="link" onclick={dismissHelpNudge} aria-label="Dismiss">Close</button>
      </div>
    {/if}
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
    {#if viewer.open && viewShown}
      <div class="view-wrap">
        <PanoramaStrip
          panorama={viewer.current}
          time={skyTime}
          dayStart={skyDayStart}
          place={pin === null && selectedHill ? `the top of ${selectedHill.hill.name.replace(/ \[.*\]$/, '')}` : skyPlace.name}
          theme={settings.theme}
          compact={narrow}
          onOpenHill={openHillNumber}
        />
      </div>
    {/if}
    {#if skyOpen}
      <div class="sky-wrap" bind:clientHeight={skyHeight}>
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
    <div class="legend small" class:folded={narrow && !keyOpen} class:hidden-under-panel={narrow && panelOpen}>
      {#if narrow}
        <button class="link key-toggle" onclick={() => (keyOpen = !keyOpen)} aria-expanded={keyOpen}>Key</button>
      {/if}
      <span aria-hidden="true"><i style="background: var(--go)"></i>Go</span>
      <span aria-hidden="true"><i style="background: var(--maybe)"></i>Maybe</span>
      <span aria-hidden="true"><i style="background: var(--no)"></i>No</span>
      {#if best}<span aria-hidden="true"><i class="best-ring"></i>Best bet</span>{/if}
      {#if openRoute}<span aria-hidden="true"><i class="route-key"></i>Walking route</span>{/if}
      {#if showOvation && conditions.ovation}
        <span title="NOAA SWPC OVATION nowcast: chance of aurora overhead">
          <i class="aurora-scale" aria-hidden="true"></i>Aurora chance now (to {formatTime(conditions.ovation.forecastFor)})
        </span>
      {/if}
      {#if auroraOutlook}
        <span title="Rule of thumb from NOAA's Kp forecast, not a model">
          <i class="aurora-line" aria-hidden="true"></i>View line, Kp {auroraOutlook.kp.toFixed(1)}
        </span>
      {:else if conditions.auroraShown && conditions.kp.length}
        <span class="muted">No Kp forecast this far ahead</span>
      {/if}
      {#if places.list.length}<span aria-hidden="true"><i class="place-dot"></i>Your place</span>{/if}
      {#if settings.start}<span aria-hidden="true"><i class="start-dot"></i>Start</span>{/if}
      {#if pin}<button class="link" onclick={() => (placeOpen = true)}>Save this spot</button>{/if}
      {#if viewShown}
        <button
          class="link"
          onclick={() => {
            viewer.open = !viewer.open;
            viewer.save();
          }}
          aria-pressed={viewer.open}>{viewer.open ? 'Hide panorama' : 'Show panorama'}</button
        >
      {/if}
      <button class="link" onclick={() => (skyOpen = !skyOpen)} aria-pressed={skyOpen}>
        {skyOpen ? 'Hide sun and moon' : 'Sun and moon'}
      </button>
    </div>
  </div>

  <Quiz bind:open={quizOpen} onDone={quizDone} />
  <PlaceEditor
    bind:open={placeOpen}
    preset={pin}
    onSaved={(p) => {
      if (!p) return;
      pin = null;
      select({ lat: p.lat, lon: p.lon, href: `?hill=${p.number}`, zoom: 12 });
    }}
  />

  {#if panelOpen}
    <aside class="panel" aria-label="Where to go">
      <header class="panel-head">
        <h1>{hillOpen ? (Number(page.url.searchParams.get('hill')) < 0 ? 'Loch' : isCustomNumber(Number(page.url.searchParams.get('hill'))) ? 'Place' : 'Hill') : 'Where to go'}</h1>
        <div class="head-buttons">
          <!-- On a phone a hill's sheet only needs closing: it has its own way back. -->
          {#if !(narrow && hillOpen)}
            <button
              class="hide"
              onclick={() => (quizOpen = true)}
              title="Answer a few questions and Atmos fills in the filters for you."
            ><span class="long">Filter&nbsp;</span><span class="cap-on-phone">quiz</span></button>
            <button
              class="hide"
              onclick={resetAll}
              disabled={!filtersChanged() && !hillOpen}
              title="Put the search back to its defaults and close any open hill. Home and start point stay."
            >Reset<span class="long">&nbsp;filters</span></button>
          {/if}
          <button class="hide close" onclick={() => (panelOpen = false)} aria-label="Hide the panel">
            <span class="long">Hide</span><span class="phone-only" aria-hidden="true">✕</span>
          </button>
        </div>
      </header>
      <div class="panel-body">
        {#if hillOpen}
          <DetailSheet />
        {:else}
        <Controls {picking} onPickStart={startPicking} />

        <div class="status small muted" aria-live="polite">
          {#if conditions.error}
            <span class="error">{conditions.error}</span>
            <button class="link" onclick={() => conditions.refresh(true)}>Try again</button>
          {:else if conditions.loading}
            Fetching forecasts{#if conditions.progress}, {conditions.progress.done} of {conditions.progress.total}{/if}…
          {:else if conditions.shared?.met}
            <span title="Fetched on the Atmos server for everyone and updated as new model runs come out.">
              Met Office updated {formatTime(conditions.shared.met)}{#if conditions.shared.ecmwf}, ECMWF {formatTime(conditions.shared.ecmwf)}{/if}. Updates itself.
            </span>
          {:else if conditions.fetchedAt}
            Forecasts from {formatTime(conditions.fetchedAt)} ({ageLabel(conditions.fetchedAt, conditions.now)}).
            <button class="link" onclick={() => conditions.refresh(true)}>Refresh</button>
          {/if}
          <a class="check-link" href="/check" title="Data check" aria-label="Data check">
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
              <path d="M1 8h3l2-5 4 10 2-5h3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </a>
        </div>

        {#if ranking.windowPassed && settings.dayOffset === 0}
          <p class="note small">Today’s window has passed in some areas; their verdicts show what was forecast.</p>
        {/if}

        <ResultsList onSelect={select} onHover={hover} />
        {/if}

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
      {#if hillOpen && openHill}
        <span class="tab-best"><VerdictMark verdict={openHill.verdict} /> {openHill.hill.name}</span>
      {:else if best && bestName}
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
  .head-buttons {
    display: flex;
    gap: 6px;
  }
  .hide:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .hide {
    border: 1px solid var(--line);
    background: var(--surface);
    border-radius: 6px;
    padding: 4px 10px;
    font-size: 0.85rem;
  }
  .panel-body > :global(*) {
    min-width: 0;
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
  .bottom > .sky-wrap,
  .bottom > .view-wrap {
    justify-self: stretch;
  }
  .view-wrap {
    min-width: 0;
    width: 100%;
    box-shadow: var(--shadow, 0 4px 14px rgb(20 29 36 / 0.18));
    border-radius: 10px;
  }
  .map-page :global(.view-handle) {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #2f6fb3;
    border: 2px solid #fff;
    box-shadow: 0 1px 3px rgb(20 29 36 / 0.4);
    cursor: grab;
  }
  .bottom.with-panel {
    right: 414px;
  }
  .map-page :global(.sky-pin) {
    cursor: grab;
    filter: drop-shadow(0 2px 3px rgb(20 29 36 / 0.35));
  }
  .map-page :global(.sky-pin:active) {
    cursor: grabbing;
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
  .legend .aurora-scale {
    width: 38px;
    height: 9px;
    border-radius: 2px;
    background: linear-gradient(90deg, rgb(46 170 98 / 0.4), rgb(120 200 60 / 0.7), rgb(240 205 50 / 0.8), rgb(226 96 58 / 0.85));
  }
  .legend .aurora-line {
    width: 18px;
    height: 0;
    border-radius: 0;
    border-top: 3px dashed #2f9e5b;
    vertical-align: 3px;
  }
  .legend .route-key {
    width: 16px;
    height: 0;
    border-radius: 0;
    border-top: 4px solid #7b3fa8;
    vertical-align: 3px;
  }
  .legend .best-ring {
    background: transparent;
    box-shadow:
      0 0 0 2.5px #1d6fe0 inset,
      0 0 0 1.5px #fff;
  }
  .legend .start-dot {
    background: #1b2731;
    box-shadow: 0 0 0 2px #fff inset;
  }
  .legend .place-dot {
    background: var(--go);
    box-shadow: 0 0 0 2px #1d2830 inset;
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

  .phone-only {
    display: none;
  }

  /* Phones: the panel becomes a drawer from the bottom. */
  @media (max-width: 640px) {
    .map-page {
      height: calc(100dvh - 50px);
    }
    .panel {
      top: auto;
      left: 0;
      right: 0;
      bottom: 0;
      width: auto;
      height: 64dvh;
      border-radius: 14px 14px 0 0;
      border-bottom: none;
    }
    /* A grab handle, so it reads as a drawer. */
    .panel::before {
      content: '';
      position: absolute;
      top: 5px;
      left: 50%;
      width: 36px;
      height: 4px;
      margin-left: -18px;
      border-radius: 2px;
      background: var(--line);
    }
    .panel-head {
      padding: 14px 12px 8px;
    }
    .head-buttons {
      gap: 4px;
    }
    .long {
      display: none;
    }
    .phone-only {
      display: inline;
    }
    .cap-on-phone {
      text-transform: capitalize;
    }
    .hide.close {
      padding: 4px 9px;
    }
    /* The key folds to a "Key" button; with the drawer open it gets out of the way. */
    .legend.folded > :not(.key-toggle):not(button) {
      display: none;
    }
    .legend.hidden-under-panel {
      display: none;
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
  /* A deliberately quiet way to the data check page. */
  .check-link {
    display: inline-flex;
    vertical-align: middle;
    margin-left: 4px;
    padding: 2px;
    color: var(--ink-soft);
    opacity: 0.3;
    transition: opacity 0.15s;
  }
  .check-link:hover,
  .check-link:focus-visible {
    opacity: 1;
  }
</style>
