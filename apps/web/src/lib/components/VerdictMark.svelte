<script lang="ts">
  import type { Confidence, Verdict } from '@atmos/engine';

  let {
    verdict,
    confidence = null,
    size = 'normal',
  }: { verdict: Verdict; confidence?: Confidence | null; size?: 'normal' | 'large' } = $props();

  const WORD: Record<Verdict, string> = { go: 'Go', maybe: 'Maybe', no: 'No', nodata: 'No data' };
  const CONF: Record<Confidence, string> = { high: 'high', medium: 'medium', low: 'low' };
</script>

<span class="mark {verdict} {size}">
  <span class="word">{WORD[verdict]}</span>
  {#if confidence && verdict !== 'nodata'}
    <span class="conf" title="Confidence: how closely the models agree">{CONF[confidence]}</span>
  {/if}
</span>

<style>
  .mark {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    white-space: nowrap;
  }
  .word {
    display: inline-block;
    min-width: 3.6em;
    text-align: center;
    font-weight: 700;
    font-stretch: 80%;
    font-size: 0.9rem;
    padding: 2px 8px;
    border-radius: 4px;
    color: var(--on-verdict);
  }
  .go .word {
    background: var(--go);
  }
  .maybe .word {
    background: var(--maybe);
  }
  .no .word {
    background: var(--no);
  }
  .nodata .word {
    background: var(--nodata);
  }
  .large .word {
    font-size: 1.15rem;
    padding: 4px 12px;
  }
  .conf {
    font-size: 0.8rem;
    color: var(--ink-soft);
  }
</style>
