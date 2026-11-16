<script lang="ts">
  /**
   * One hill, shown in the side panel in place of the results: its photo score, every
   * condition broken down, the trip and the reasons. Not modal, so the map and the
   * timeline stay usable alongside it.
   */
  import { explain, formatDuration, googleMapsDirectionsUrl, hillIsOnList } from '@atmos/engine';
  import { ensembleShare, type EnsembleVariable } from '@atmos/data-client';
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
  const isRisk = (c: ConditionTrip) => conditions.data?.config.profiles[c.profileId]?.risk ?? false;
  const breakdown = $derived.by(() => {
    if (!hillResult) return { counted: [] as ConditionTrip[], others: [] as ConditionTrip[] };
    const counted = new Set(hillResult.counted.map(keyOf));
    return {
      counted: hillResult.counted,
      others: hillResult.conditions.filter((c) => !counted.has(keyOf(c)) && !isRisk(c)),
    };
  });

  /** Midges: the worse of dawn and dusk. A higher score means more midges. */
  const midges = $derived.by(() => {
    const list = hillResult?.conditions.filter(isRisk) ?? [];
    const worst = list.reduce<ConditionTrip | null>(
      (a, b) => ((b.result.score ?? 0) > (a?.result.score ?? -1) ? b : a),
      null,
    );
    if (!worst || worst.result.score === null) return null;
    const level = worst.result.verdict === 'go' ? 'high' : worst.result.verdict === 'maybe' ? 'moderate' : 'low';
    return { level, period: worst.period };
  });

  // The ensemble for this hill: fetched when it opens.
  $effect(() => {
    const h = hillResult?.hill;
    if (h) void conditions.loadEnsemble(h.number, h.lat, h.lon);
  });
  const ensemble = $derived(hillResult ? conditions.ensembles.get(hillResult.hill.number) : undefined);

  /** What the ensemble is asked, for the chosen condition, at its best hour. */
  const ENSEMBLE_CHECKS: Record<string, { label: string; variable: EnsembleVariable; test: (v: number) => boolean; key?: boolean }[]> = {
    clear: [{ label: 'Clear sky (under 30% cloud)', variable: 'cloud_cover', test: (v) => v < 30, key: true }],
    lowFill: [{ label: 'Cloud filling the valleys (over 70% low cloud)', variable: 'cloud_cover_low', test: (v) => v > 70, key: true }],
    noLow: [{ label: 'Little low cloud (under 40%)', variable: 'cloud_cover_low', test: (v) => v < 40, key: true }],
    dry: [{ label: 'Dry (under 0.2 mm)', variable: 'precipitation', test: (v) => v < 0.2 }],
    calm: [{ label: 'Light wind (under 15 km/h)', variable: 'wind_speed_10m', test: (v) => v < 15 }],
  };
  const CHECKS_FOR: Record<string, string[]> = {
    inversion: ['lowFill', 'calm'],
    mist: ['lowFill', 'calm'],
    sky: ['noLow', 'dry'],
    dramatic: ['noLow', 'dry'],
    alpenglow: ['noLow', 'dry'],
    reflections: ['calm', 'dry'],
    frozen: ['calm', 'dry'],
    astro: ['clear', 'dry'],
    aurora: ['clear', 'dry'],
    clarity: ['clear', 'dry'],
    frost: ['clear', 'calm'],
    snow: ['clear', 'dry'],
  };
  const ensembleRows = $derived.by(() => {
    if (!chosen || !ensemble || typeof ensemble === 'string') return [];
    const ref = chosen.result.byModel.find((m) => m.model === chosen.result.referenceModel);
    const at = ref?.keyHour?.time;
    if (at === undefined) return [];
    return (CHECKS_FOR[chosen.profileId] ?? ['dry', 'calm'])
      .flatMap((k) => ENSEMBLE_CHECKS[k] ?? [])
      .map((c) => ({ ...c, share: ensembleShare(ensemble, c.variable, at, c.test) }))
      .filter((r) => r.share !== null);
  });
  /** The deciding check found in fewer than half the runs: worth a warning. */
  const ensembleDoubt = $derived(
    ensembleRows.some((r) => r.key && r.share && r.share.yes / r.share.of < 0.5),
  );

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

  let view: HTMLElement | undefined = $state();
  // Start each hill at the top, with focus on its name for keyboard and screen readers.
  $effect(() => {
    void hillParam;
    if (view) {
      view.closest('.panel-body')?.scrollTo({ top: 0 });
      view.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
    }
  });

  function onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    if (e.key === 'Escape' && open && !t?.closest('input, select, textarea')) close();
  }

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

<svelte:window onkeydown={onKey} />

{#if open}
  <div class="hill-view" bind:this={view} role="region" aria-labelledby="sheet-title">
    <div class="nav">
      <button class="back" onclick={close}>Back to results</button>
    </div>
    <header>
      <div>
        <h2 id="sheet-title" tabindex="-1">{hillResult?.hill.name ?? 'Hill'}</h2>
        {#if hillResult}
          <p class="muted small">
            {Math.round(hillResult.hill.metres)} m{#if lists.length}, {lists.join(', ')}{/if}. {hillResult.zone.name}.
          </p>
          {#if hillResult.searchOnly}
            <p class="small muted">Not on your hill lists (most of these are Tumps), so it only appears when you search for it. It isn’t in the results or the best bet.</p>
          {/if}
        {/if}
      </div>
    </header>

    {#if !hillResult}
      <p class="muted">
        {#if conditions.loading}Fetching the forecast for this hill…{:else}No forecast for this hill with the current day and filters.{/if}
      </p>
    {:else}
      <section class="verdict">
        <VerdictMark verdict={hillResult.verdict} confidence={hillResult.best?.result.confidence ?? null} size="large" />
        <p><strong class="big">{pct(hillResult.score)}</strong> <span class="small muted">photo score, from the conditions you’ve ticked</span></p>
      </section>
      {#if midges && midges.level !== 'low'}
        <p class="midges {midges.level}">
          Midges: {midges.level} risk at {midges.period === 'morning' ? 'dawn' : 'dusk'}. Warm, damp, still air; take a net and repellent.
        </p>
      {/if}

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
          {#if result.agreement?.outvoted}
            <p class="small warn">Only {result.agreement.go} of {result.agreement.models} models say Go, so it’s a Maybe.</p>
          {/if}
          <div class="ensemble">
            <h4 class="small">Ensemble check{#if ensembleRows.length}, ECMWF runs at {clock(chosen.result.byModel.find((m) => m.model === chosen.result.referenceModel)?.keyHour?.time ?? 0)}{/if}</h4>
            {#if ensemble === 'loading' || ensemble === undefined}
              <p class="small muted">Fetching the ensemble…</p>
            {:else if ensemble === 'failed'}
              <p class="small muted">The ensemble isn’t available right now.</p>
            {:else if ensembleRows.length === 0}
              <p class="small muted">The ensemble doesn’t reach this hour.</p>
            {:else}
              <ul>
                {#each ensembleRows as r (r.label)}
                  <li>
                    <span>{r.label}</span>
                    <span class="ens-bar" aria-hidden="true"><i style="width: {Math.round((r.share!.yes / r.share!.of) * 100)}%"></i></span>
                    <strong>{r.share!.yes} of {r.share!.of}</strong>
                  </li>
                {/each}
              </ul>
              {#if ensembleDoubt}
                <p class="small warn">Most ensemble runs disagree with the main forecast here: treat it as a long shot.</p>
              {:else}
                <p class="small muted">Each run is the same model started from slightly different conditions; more runs agreeing means more confidence.</p>
              {/if}
            {/if}
          </div>
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
  </div>
{/if}

<style>
  .midges {
    margin: 8px 0 0;
    padding: 6px 10px;
    border-radius: 6px;
    font-size: 0.88rem;
    background: color-mix(in srgb, var(--maybe) 14%, transparent);
  }
  .midges.high {
    background: color-mix(in srgb, var(--no) 14%, transparent);
  }
  .ensemble {
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px solid var(--line);
  }
  .ensemble h4 {
    margin: 0 0 4px;
    font-weight: 650;
  }
  .ensemble ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 4px;
    font-size: 0.86rem;
  }
  .ensemble li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 60px auto;
    gap: 8px;
    align-items: center;
  }
  .ens-bar {
    height: 6px;
    border-radius: 3px;
    background: var(--line);
    overflow: hidden;
  }
  .ens-bar i {
    display: block;
    height: 100%;
    background: var(--ink-soft);
  }
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
    grid-template-columns: minmax(0, 1fr) 48px 2em auto;
    gap: 8px;
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
  .hill-view {
    display: grid;
    min-width: 0;
  }
  .hill-view > * {
    min-width: 0;
  }
  .nav {
    display: flex;
    justify-content: space-between;
    gap: 10px;
  }
  .back {
    border: 1px solid var(--line);
    background: var(--surface);
    border-radius: 6px;
    padding: 3px 10px;
    font-size: 0.84rem;
    color: var(--ink);
  }
  h2:focus {
    outline: none;
  }
  header {
    position: sticky;
    top: -14px;
    background: var(--paper);
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 0 10px;
    border-bottom: 1px solid var(--line);
    z-index: 1;
  }
  h2 {
    font-size: 1.7rem;
    font-stretch: 68%;
    font-weight: 800;
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
