<script lang="ts">
  /** The window's hours for one model: a bar per hour, height = score, colour = verdict. */
  import type { WindowResult } from '@atmos/engine';
  import { formatTime } from '#lib/time.ts';

  let { window: w, keyTime }: { window: WindowResult; keyTime: number | null } = $props();
</script>

{#if w.hours.length > 0}
  <ol class="hours" aria-label="Score for each hour">
    {#each w.hours as h (h.time)}
      <li class:key={h.time === keyTime}>
        <span class="bar-wrap">
          <span
            class="bar {h.verdict}"
            style="height: {Math.max(6, Math.round((h.gated ? 0.06 : (h.score ?? 0)) * 100))}%"
          ></span>
        </span>
        <span class="t">{formatTime(h.time)}</span>
        <span class="visually-hidden">
          {h.verdict === 'nodata' ? 'no data' : `${h.verdict}${h.gated ? ', blocked' : ''}, score ${Math.round((h.score ?? 0) * 100)}`}
        </span>
      </li>
    {/each}
  </ol>
{/if}

<style>
  .hours {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    gap: 4px;
    align-items: flex-end;
    overflow-x: auto;
  }
  li {
    flex: 1 0 34px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  .bar-wrap {
    height: 56px;
    width: 100%;
    display: flex;
    align-items: flex-end;
    background: var(--surface);
    border-radius: 3px;
  }
  .bar {
    width: 100%;
    border-radius: 3px;
  }
  .bar.go {
    background: var(--go);
  }
  .bar.maybe {
    background: var(--maybe);
  }
  .bar.no {
    background: var(--no);
  }
  .bar.nodata {
    background: var(--nodata);
  }
  .t {
    font-size: 0.75rem;
    color: var(--ink-soft);
  }
  li.key .t {
    color: var(--ink);
    font-weight: 700;
  }
</style>
