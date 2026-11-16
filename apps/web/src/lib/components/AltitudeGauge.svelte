<script lang="ts">
  /**
   * A small vertical gauge: the summit (tick) against the forecast cloud layers
   * (mist bands) at the key hour. Above the cloud, the tick turns gold.
   */
  import type { Layer } from '@atmos/engine';

  let {
    summitM,
    groundM,
    layers,
    topM = 1400,
  }: { summitM: number; groundM: number; layers: Layer[]; topM?: number } = $props();

  const H = 44;
  const y = (m: number) => H - (Math.min(Math.max(m, 0), topM) / topM) * H;
  const inCloud = $derived(layers.some((l) => l.baseM <= summitM && summitM <= l.topM));
  const aboveCloud = $derived(!inCloud && layers.some((l) => l.topM < summitM));
  const label = $derived(
    inCloud
      ? `Summit ${Math.round(summitM)} m is in cloud`
      : aboveCloud
        ? `Summit ${Math.round(summitM)} m is above the cloud`
        : `Summit ${Math.round(summitM)} m, no low cloud forecast`,
  );
</script>

<svg width="14" height={H} viewBox="0 0 14 {H}" role="img" aria-label={label}>
  <title>{label}</title>
  <rect x="5" y="0" width="4" height={H} rx="2" class="track" />
  {#each layers as l, i (i)}
    <rect x="1" y={y(l.topM)} width="12" height={Math.max(2, y(l.baseM) - y(l.topM))} class="cloud" />
  {/each}
  <rect x="5" y={y(groundM)} width="4" height={H - y(groundM)} class="ground" />
  <rect x="0" y={y(summitM) - 1.5} width="14" height="3" rx="1.5" class:above={aboveCloud} class="summit" />
</svg>

<style>
  svg {
    flex: none;
    display: block;
  }
  .track {
    fill: var(--line);
  }
  .cloud {
    fill: var(--mist);
    opacity: 0.95;
  }
  .ground {
    fill: var(--ink-soft);
    opacity: 0.35;
  }
  .summit {
    fill: var(--ink);
  }
  .summit.above {
    fill: var(--gold);
  }
</style>
