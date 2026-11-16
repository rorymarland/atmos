<script lang="ts">
  /** One hill: its photo score, every condition broken down, the trip and the reasons. */
  import { explain, formatDuration, googleMapsDirectionsUrl, hillIsOnList } from '@atmos/engine';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { conditions, keyHourProfile, type ConditionTrip } from '#lib/conditions.svelte.ts';
  import { settings } from '#lib/settings.svelte.ts';
  import { modelLabel } from '#lib/static-data.ts';
  import { PERIOD_LABELS } from '#lib/sun.ts';
  import { formatClock, formatTime, londonMidnight } from '#lib/time.ts';
  import AirColumn from './AirColumn.svelte';
  import HourStrip from './HourStrip.svelte';
  import VerdictMark from './VerdictMark.svelte';

  const hillParam = $derived(page.url.searchParams.get('hill'));
  const ranking = $derived(conditions.ranking);
  const hillResult = $derived(hillParam ? ranking.hillsByNumber.get(Number(hillParam)) : undefined);
  const open = $derived(Boolean(hillParam));
  const keyOf = (c: ConditionTrip) => `${c.profileId}-${c.period}`;

  /** Counted conditions first (best first), then the rest. */
  const breakdown = $derived.by(() => {
    if (!hillResult) return { counted: [] as ConditionTrip[], others: [] as ConditionTrip[] };
    const counted = new Set(hillResult.counted.map(keyOf));
    return {
      counted: hillResult.counted,
      others: hillResult.conditions.filter((c) => !counted.has(keyOf(c))),
    };
  });

  let chosenKey = $state<string | null>(null);
  $effect(() => {
    void hillParam;
    chosenKey = null;
  });
  const chosen = $derived(
    hillResult
      ? (hillResult.conditions.find((c) => keyOf(c) === chosenKey) ?? hillResult.best ?? hillResult.conditions[0] ?? null)
      : null,
  );

  const result = $derived(chosen?.result);
  const forecasts = $derived(hillResult ? conditions.forecastsFor(hillResult.zone.id) : []);
  const key = $derived(result ? keyHourProfile(result, forecasts) : null);
  const reasons = $derived(result ? explain(result, { wind: settings.wind }, modelLabel) : []);
  const reference = $derived(result?.byModel.find((m) => m.model === result.referenceModel));
  const lists = $derived(
    hillResult && conditions.data
      ? conditions.data.lists.filter((l) => hillIsOnList(hillResult.hill, l)).map((l) => l.label)
      : [],
  );
  const trip = $derived(chosen?.trip ?? null);
  const dayStart = $derived(londonMidnight(settings.dayOffset, conditions.now));
  const clock = (ms: number) => formatClock(ms, dayStart);
  const pct = (score: number | null) => (score === null ? '–' : String(Math.round(score * 100)));
  const keyTime = (c: ConditionTrip) => {
    const ref = c.result.byModel.find((m) => m.model === c.result.referenceModel);
    return ref?.keyHour ? clock(ref.keyHour.time) : null;
  };
  const leaveName = $derived(
    settings.home && settings.start && settings.home.lat === settings.start.lat && settings.home.lon === settings.start.lon
      ? 'home'
      : (settings.start?.label ?? ''),
  );

  let dialog: HTMLDialogElement | undefined = $state();

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });

  function close() {
    const url = new URL(page.url.href);
    url.searchParams.delete('hill');
    goto(url, { replace: true, reset: false });
  }

  const STATUS_WORD = { good: 'Good', ok: 'Fair', poor: 'Poor', blocked: 'Blocks', nodata: 'No data', info: 'Note' };
</script>

{#snippet conditionRow(c: ConditionTrip)}
  {@const k = keyOf(c)}
  {@const selected = chosen && keyOf(chosen) === k}
  <li>
    <button class="cond" class:selected aria-pressed={selected} onclick={() => (chosenKey = k)}>
      <span class="cond-name">
        <strong>{conditions.label(c.profileId)}</strong>
        <span class="small muted">{PERIOD_LABELS[c.period]}{#if keyTime(c)}, best {keyTime(c)}{/if}{#if c.scope === 'valley'}, valley forecast{/if}</span>
      </span>
      <span class="bar" aria-hidden="true"><i class={c.result.verdict} style="width: {Math.round((c.result.score ?? 0) * 100)}%"></i></span>
      <span class="cond-score">{pct(c.result.score)}</span>
      <VerdictMark verdict={c.result.verdict} />
    </button>
  </li>
{/snippet}

<dialog bind:this={dialog} onclose={close} aria-labelledby="sheet-title">
  {#if open}
    <header>
      <div>
        <h2 id="sheet-title">{hillResult?.hill.name ?? 'Hill'}</h2>
        {#if hillResult}
          <p class="muted small">
            {Math.round(hillResult.hill.metres)} m{#if lists.length}, {lists.join(', ')}{/if}. {hillResult.zone.name}.
          </p>
        {/if}
      </div>
      <button class="close" onclick={() => dialog?.close()} aria-label="Close">×</button>
    </header>

    {#if !hillResult}
      <p class="muted">No forecast for this hill with the current day and filters.</p>
    {:else}
      <section class="verdict">
        <VerdictMark verdict={hillResult.verdict} confidence={hillResult.best?.result.confidence ?? null} size="large" />
        <p><strong class="big">{pct(hillResult.score)}</strong> <span class="small muted">photo score, from the conditions you’ve ticked</span></p>
      </section>

      <section>
        <h3>Conditions</h3>
        <p class="small muted">Pick one to see why it scores as it does and when to leave for it.</p>
        {#if breakdown.counted.length}
          <ul class="conds">{#each breakdown.counted as c (keyOf(c))}{@render conditionRow(c)}{/each}</ul>
        {/if}
        {#if breakdown.others.length}
          <details class="others" open={breakdown.counted.length === 0}>
            <summary class="small">Not counted: {breakdown.others.length} (unticked, another time of day, or out of reach)</summary>
            <ul class="conds">{#each breakdown.others as c (keyOf(c))}{@render conditionRow(c)}{/each}</ul>
          </details>
        {/if}
      </section>

      {#if chosen && result}
        <section class="chosen">
          <h3>{conditions.label(chosen.profileId)}, {PERIOD_LABELS[chosen.period].toLowerCase()}</h3>
          <p class="small muted">
            {conditions.data?.config.profiles[chosen.profileId]?.blurb}
            {chosen.window.label}: {formatTime(chosen.window.start)} to {formatTime(chosen.window.end)}.
            {#if chosen.scope === 'valley'}Judged from the {hillResult.zone.name} valley forecast, so it’s shared by nearby hills.{:else}Judged at the summit’s height.{/if}
          </p>
          <ul class="reasons">
            {#each reasons as r, i (i)}
              <li class={r.status}><span class="status">{STATUS_WORD[r.status]}</span><span>{r.text}</span></li>
            {/each}
          </ul>
          <p class="models small">
            {#each result.byModel as m (m.model)}
              <span>{modelLabel(m.model)}: <VerdictMark verdict={m.verdict} /></span>
            {/each}
          </p>
        </section>

        <section class="plan">
          <h3>Your trip</h3>
          {#if trip}
            <ol class="timeline">
              <li><span class="t">{clock(trip.plan.wakeAt)}</span> {chosen.period === 'morning' ? 'Get up' : 'Get ready'}</li>
              <li class="leave"><span class="t">{clock(trip.plan.leaveAt)}</span> Leave {leaveName}</li>
              <li><span class="t">{clock(trip.plan.parkAt)}</span> Park, after about {formatDuration(trip.driveMinutes)} and {Math.round(trip.roadMiles)} miles</li>
              <li><span class="t">{clock(trip.plan.arriveAt)}</span> In place, after a {formatDuration(trip.walkMinutes)} {chosen.scope === 'summit' ? 'walk up' : 'walk'}</li>
              <li><span class="t">{clock(trip.plan.target)}</span> {trip.targetLabel.charAt(0).toUpperCase() + trip.targetLabel.slice(1)}</li>
            </ol>
            {#if trip.problem === 'too-early'}
              <p class="small warn">That means getting up before {settings.earliestUp}.</p>
            {:else if trip.problem === 'too-late'}
              <p class="small warn">You’d already need to have left.</p>
            {/if}
            <p class="small muted">
              Rough estimates: the drive from straight-line distance with typical road speeds, the walk
              {chosen.scope === 'summit' ? 'by Naismith’s rule from the valley floor' : 'a short stroll from parking'}. Check the real route below.
            </p>
          {:else}
            <p class="small muted">Set a start point or <a href="/settings#home">your home</a> to see when to leave.</p>
          {/if}
        </section>

        {#if reference}
          <section>
            <h3>Hour by hour ({modelLabel(reference.model)})</h3>
            <HourStrip window={reference} keyTime={reference.keyHour?.time ?? null} />
          </section>
        {/if}

        {#if key && chosen.scope === 'summit'}
          <section>
            <h3>The air above the valley at {formatTime(key.forecast.time[key.index]!)}</h3>
            <AirColumn forecast={key.forecast} index={key.index} summitM={hillResult.hill.metres} summitName={hillResult.hill.name} />
          </section>
        {/if}
      {/if}

      <section class="sun">
        <h3>Sun</h3>
        <dl>
          {#each [['Dawn', hillResult.sun.civilDawn], ['Golden hour', hillResult.sun.goldenStart], ['Sunrise', hillResult.sun.sunrise], ['Sunset', hillResult.sun.sunset], ['Blue hour', hillResult.sun.eveningBlueStart], ['Dusk', hillResult.sun.civilDusk]] as const as [label, t] (label)}
            <div><dt>{label}</dt><dd>{t ? formatTime(t) : 'none'}</dd></div>
          {/each}
        </dl>
      </section>

      <section class="links">
        <a class="button" href={googleMapsDirectionsUrl({ lat: hillResult.hill.lat, lon: hillResult.hill.lon }, settings.start ?? undefined)} target="_blank" rel="noopener">
          Directions in Google Maps
        </a>
        {#if hillResult.miles != null}
          <span class="small muted">{Math.round(hillResult.miles)} miles in a straight line</span>
        {/if}
        <p class="small">
          <a href="https://www.hill-bagging.co.uk/mountaindetails.php?rf={hillResult.hill.number}" target="_blank" rel="noopener">Hill details on Hill Bagging</a>.
          Before you go, check the <a href="https://www.metoffice.gov.uk/weather/specialist-forecasts/mountain" target="_blank" rel="noopener">Met Office mountain forecast</a>
          and <a href="https://www.mwis.org.uk/" target="_blank" rel="noopener">MWIS</a>.
        </p>
      </section>
    {/if}
  {/if}
</dialog>

<style>
  .big {
    font-size: 1.7rem;
    font-stretch: 70%;
    font-weight: 850;
  }
  .conds {
    list-style: none;
    margin: 4px 0 0;
    padding: 0;
    display: grid;
  }
  .cond {
    width: 100%;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 72px 2.2em auto;
    gap: 10px;
    align-items: center;
    text-align: left;
    background: none;
    border: none;
    border-bottom: 1px solid var(--line);
    padding: 7px 4px;
    color: inherit;
    cursor: pointer;
  }
  .cond:hover {
    background: var(--surface);
  }
  .cond.selected {
    background: var(--surface);
    box-shadow: inset 3px 0 0 var(--gold);
  }
  .cond-name {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .bar {
    height: 6px;
    border-radius: 3px;
    background: var(--line);
    overflow: hidden;
  }
  .bar i {
    display: block;
    height: 100%;
    background: var(--nodata, #8a979f);
  }
  .bar i.go {
    background: var(--go);
  }
  .bar i.maybe {
    background: var(--maybe);
  }
  .bar i.no {
    background: var(--no);
  }
  .cond-score {
    font-weight: 750;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .others summary {
    cursor: pointer;
    color: var(--ink-soft);
    margin-top: 8px;
  }
  .timeline {
    list-style: none;
    padding: 0 0 0 12px;
    margin: 4px 0 8px;
    border-left: 2px solid var(--line);
    display: grid;
    gap: 5px;
  }
  .timeline .t {
    display: inline-block;
    min-width: 5.6em;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .timeline .leave {
    font-weight: 700;
  }
  .timeline .leave .t {
    text-decoration: underline 3px var(--gold);
    text-underline-offset: 5px;
  }
  .warn {
    color: var(--no);
    font-weight: 600;
  }
  dialog {
    border: none;
    padding: 0 20px 28px;
    background: var(--paper);
    color: var(--ink);
    width: min(560px, 100vw);
    max-width: 100vw;
    height: 100dvh;
    max-height: 100dvh;
    margin: 0 0 0 auto;
    box-shadow: -1px 0 0 var(--line);
    overflow-y: auto;
  }
  dialog::backdrop {
    background: rgb(20 29 36 / 0.35);
  }
  @media (max-width: 640px) {
    dialog {
      margin: auto 0 0;
      height: 88dvh;
      border-radius: 14px 14px 0 0;
    }
  }
  header {
    position: sticky;
    top: 0;
    background: var(--paper);
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 18px 0 12px;
    border-bottom: 1px solid var(--line);
    z-index: 1;
  }
  h2 {
    font-size: 1.7rem;
    font-stretch: 68%;
    font-weight: 800;
  }
  .close {
    border: none;
    background: none;
    font-size: 1.8rem;
    line-height: 1;
    padding: 0 4px;
    align-self: flex-start;
  }
  section {
    padding: 16px 0;
    border-bottom: 1px solid var(--line);
  }
  section h3 {
    margin-bottom: 10px;
  }
  .verdict {
    display: grid;
    gap: 8px;
  }
  .reasons {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 6px;
  }
  .reasons li {
    display: grid;
    grid-template-columns: 4.5em 1fr;
    gap: 8px;
  }
  .status {
    font-size: 0.8rem;
    font-weight: 650;
    padding-top: 2px;
  }
  .good .status {
    color: var(--go);
  }
  .ok .status {
    color: var(--maybe);
  }
  .poor .status,
  .blocked .status {
    color: var(--no);
  }
  .nodata .status,
  .info .status {
    color: var(--ink-soft);
  }
  .models {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    margin-top: 12px;
    color: var(--ink-soft);
  }
  .sun dl {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin: 0;
  }
  .sun dt {
    font-size: 0.8rem;
    color: var(--ink-soft);
  }
  .sun dd {
    margin: 0;
    font-weight: 650;
    color: var(--ink);
  }
  .sun dd::before {
    content: '';
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--gold);
    margin-right: 6px;
    vertical-align: 1px;
  }
  .links {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 14px;
    border-bottom: none;
  }
  .links p {
    flex-basis: 100%;
  }
</style>
