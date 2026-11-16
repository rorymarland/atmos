<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import type { Map as MapLibreMap, GeoJSONSource, MapMouseEvent } from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import { conditions } from '#lib/conditions.svelte.ts';
  import { settings } from '#lib/settings.svelte.ts';
  import Controls from '#lib/components/Controls.svelte';

  let container: HTMLDivElement;
  let map: MapLibreMap | null = $state(null);
  let loaded = $state(false);
  let startPrompt = $state<{ lat: number; lon: number } | null>(null);

  const VERDICT_COLOURS = { go: '#2f7a50', maybe: '#b98318', no: '#a3412b', nodata: '#8a979f' };

  const features = $derived.by(() => {
    const r = conditions.ranking;
    if (r.summitProfile) {
      return [...r.hillsByNumber.values()].map((h) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [h.hill.lon, h.hill.lat] },
        properties: {
          kind: 'hill',
          id: h.hill.number,
          name: h.hill.name,
          verdict: h.result.verdict,
          rank: { go: 3, maybe: 2, no: 1, nodata: 0 }[h.result.verdict],
        },
      }));
    }
    return r.zones.map((z) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [z.zone.forecastPoint.lon, z.zone.forecastPoint.lat] },
      properties: {
        kind: 'zone',
        id: z.zone.id,
        name: z.zone.name,
        verdict: z.result.verdict,
        rank: { go: 3, maybe: 2, no: 1, nodata: 0 }[z.result.verdict],
      },
    }));
  });

  onMount(() => {
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
        fitBoundsOptions: { padding: { top: 150, bottom: 60, left: 20, right: 60 } },
        maxBounds: [
          [-14, 48.5],
          [4, 61.5],
        ],
        attributionControl: { compact: true },
      });
      // MapLibre reports bad layers and failed tiles as events, not exceptions.
      m.on('error', (e) => console.warn('Map:', e.error?.message ?? e));
      m.addControl(new maplibre.NavigationControl({ visualizePitch: true }), 'top-right');
      m.on('load', () => {
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
        m.addSource('targets', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({
          id: 'targets',
          type: 'circle',
          source: 'targets',
          layout: { 'circle-sort-key': ['get', 'rank'] },
          paint: {
            // Zoom must be the top-level input; the zone/hill choice goes inside each stop.
            'circle-radius': [
              'interpolate',
              ['linear'],
              ['zoom'],
              5,
              ['case', ['==', ['get', 'kind'], 'zone'], 8, 3.5],
              9,
              ['case', ['==', ['get', 'kind'], 'zone'], 12, 7],
            ],
            'circle-color': [
              'match',
              ['get', 'verdict'],
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
          const f = e.features?.[0];
          if (!f) return;
          const p = f.properties as { kind: string; id: string | number };
          goto(p.kind === 'hill' ? `?hill=${p.id}` : `?zone=${p.id}`, { reset: false });
        });
        m.on('mouseenter', 'targets', () => (m.getCanvas().style.cursor = 'pointer'));
        m.on('mouseleave', 'targets', () => (m.getCanvas().style.cursor = ''));
        // Long press or right-click: offer to make this the start point for distances.
        m.on('contextmenu', (e: MapMouseEvent) => {
          startPrompt = { lat: e.lngLat.lat, lon: e.lngLat.lng };
        });
        loaded = true;
      });
      map = m;
    })();
    return () => {
      destroyed = true;
      map?.remove();
    };
  });

  $effect(() => {
    const data = { type: 'FeatureCollection' as const, features };
    if (!map || !loaded) return;
    (map.getSource('targets') as GeoJSONSource | undefined)?.setData(data);
  });

  function setStart() {
    if (!startPrompt) return;
    settings.start = {
      lat: Math.round(startPrompt.lat * 1e4) / 1e4,
      lon: Math.round(startPrompt.lon * 1e4) / 1e4,
      label: 'a point chosen on the map',
    };
    startPrompt = null;
  }
</script>

<svelte:head><title>Atmos: map</title></svelte:head>

<div class="map-page">
  <div class="panel"><Controls compact /></div>
  <div class="map" bind:this={container} role="region" aria-label="Map of hills coloured by verdict"></div>
  <div class="legend small" aria-hidden="true">
    <span><i style="background: var(--go)"></i>Go</span>
    <span><i style="background: var(--maybe)"></i>Maybe</span>
    <span><i style="background: var(--no)"></i>No</span>
    <span class="muted">Right-click or long-press to set your start point</span>
  </div>
  {#if startPrompt}
    <div class="start-prompt" role="dialog" aria-label="Set start point">
      <span class="small">Use {startPrompt.lat.toFixed(3)}, {startPrompt.lon.toFixed(3)} as your start point for distances?</span>
      <button class="button" onclick={setStart}>Set start point</button>
      <button class="button quiet" onclick={() => (startPrompt = null)}>Cancel</button>
    </div>
  {/if}
</div>

<style>
  .map-page {
    position: relative;
    height: calc(100dvh - 64px);
    min-height: 420px;
  }
  .map {
    position: absolute;
    inset: 0;
  }
  .panel {
    position: absolute;
    z-index: 2;
    top: 12px;
    left: 12px;
    right: 64px;
    max-width: 640px;
    background: color-mix(in srgb, var(--paper) 92%, transparent);
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid var(--line);
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
  .start-prompt {
    position: absolute;
    z-index: 3;
    left: 50%;
    bottom: 80px;
    transform: translateX(-50%);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 10px 12px;
    width: min(92vw, 520px);
  }
  @media (max-width: 640px) {
    .map-page {
      height: calc(100dvh - 58px - 62px);
    }
    .legend {
      bottom: 12px;
    }
  }
</style>
