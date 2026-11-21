<script lang="ts">
  /**
   * "Line it up": where to stand for the sun or moon to sit on this summit, on the day being
   * looked at. Shows the standpoints on the map and lists them every ten minutes or so.
   */
  import { googleMapsDirectionsUrl, type AlignBody, type AlignmentPoint } from '@atmos/engine';
  import { alignment, compass } from '#lib/alignment.svelte.ts';
  import { formatTime } from '#lib/time.ts';
  import Spinner from './Spinner.svelte';

  let { hill, dayOffset }: { hill: { number: number; name: string; lat: number; lon: number; metres: number }; dayOffset: number } = $props();

  const result = $derived(alignment.current && alignment.current.hill === hill.number && alignment.current.dayOffset === dayOffset ? alignment.current : null);

  const WORDS: Record<AlignBody, { rising: string; setting: string; name: string }> = {
    sun: { rising: 'Morning', setting: 'Afternoon and evening', name: 'sun' },
    moon: { rising: 'Moonrise', setting: 'Moonset', name: 'moon' },
  };

  /**
   * Points ten minutes apart, or further apart on a winter day when the sun stays low for
   * hours, so each part of the day lists about a dozen. The last is always kept.
   */
  function every(points: AlignmentPoint[]): AlignmentPoint[] {
    if (points.length === 0) return [];
    const span = (points[points.length - 1]!.time - points[0]!.time) / 60_000;
    const minutes = Math.max(10, Math.ceil(span / 12 / 10) * 10);
    const out: AlignmentPoint[] = [];
    for (const p of points) {
      const last = out[out.length - 1];
      if (!last || p.time - last.time >= minutes * 60_000 - 1) out.push(p);
    }
    const end = points[points.length - 1]!;
    if (out[out.length - 1] !== end && end.time - out[out.length - 1]!.time >= 4 * 60_000) out.push(end);
    return out;
  }
  const groups = $derived.by(() => {
    if (!result || result.status !== 'ready') return [];
    return (['rising', 'setting'] as const)
      .map((phase) => ({ phase, label: WORDS[result.body][phase], rows: every(result.points.filter((p) => p.phase === phase)) }))
      .filter((g) => g.rows.length);
  });
  const km = (d: number) => (d >= 10 ? `${Math.round(d)} km` : `${d.toFixed(1)} km`);
</script>

<section class="align">
  <h3>Line it up</h3>
  <p class="small muted">Where to stand for the sun or moon to sit on the summit{dayOffset === 0 ? ' today' : ''}. Worked out from terrain heights; the points show on the map.</p>
  <div class="buttons">
    {#each ['sun', 'moon'] as const as body (body)}
      <button type="button" class:active={result?.body === body} aria-pressed={result?.body === body} onclick={() => (result?.body === body ? alignment.clear() : alignment.find(hill, body, dayOffset))}>
        {body === 'sun' ? 'Sun' : 'Moon'}
      </button>
    {/each}
  </div>

  {#if result?.status === 'loading'}
    <p class="small"><Spinner /> Loading the terrain around {hill.name}…</p>
  {:else if result?.status === 'failed'}
    <p class="small">Couldn’t load the terrain, so this can’t be worked out just now.</p>
  {:else if result?.status === 'ready'}
    {#if result.moonLit !== undefined}
      <p class="small">The moon is {Math.round(result.moonLit * 100)}% lit{result.moonLit < 0.15 ? ', so it may be hard to see' : ''}.</p>
    {/if}
    {#if groups.length === 0}
      <p class="small">Nowhere within 40 km lines the {WORDS[result.body].name} up with the summit that day{result.hidden ? ': nearer hills hide it from every spot that would' : ''}.</p>
    {/if}
    {#each groups as g (g.phase)}
      <h4>{g.label}</h4>
      <table class="small">
        <thead><tr><th>Time</th><th>Stand</th><th>Height</th><th></th></tr></thead>
        <tbody>
          {#each g.rows as p (p.time + p.distanceKm)}
            <tr>
              <td>{formatTime(p.time)}</td>
              <td>{km(p.distanceKm)} {compass(p.bearingDeg + 180)} of the summit</td>
              <td>{p.groundM} m</td>
              <td><a href={googleMapsDirectionsUrl({ lat: p.lat, lon: p.lon })} target="_blank" rel="noopener">Directions</a></td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/each}
    {#if groups.length}
      <p class="small muted">Times are for the centre of the {WORDS[result.body].name} on the summit; it takes about two minutes to move its own width. Spots where nearer ground hides the summit are left out. Terrain is about 40 m across, so walk about a little to fine-tune.</p>
    {/if}
  {/if}
</section>

<style>
  .buttons {
    display: flex;
    gap: 8px;
    margin: 6px 0 8px;
  }
  .buttons button.active {
    background: var(--accent, #1f4fa0);
    color: #fff;
  }
  h4 {
    margin: 10px 0 4px;
    font-size: 0.9rem;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th {
    text-align: left;
    font-weight: 600;
    color: var(--ink-soft);
  }
  td,
  th {
    padding: 3px 6px 3px 0;
  }
</style>
