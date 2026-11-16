<script lang="ts">
  import { explain, formatDuration, googleMapsDirectionsUrl, hillIsOnList } from '@atmos/engine';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { conditions, keyHourProfile } from '#lib/conditions.svelte.ts';
  import { settings } from '#lib/settings.svelte.ts';
  import { modelLabel } from '#lib/static-data.ts';
  import { formatClock, formatTime, londonMidnight } from '#lib/time.ts';
  import AirColumn from './AirColumn.svelte';
  import HourStrip from './HourStrip.svelte';
  import VerdictMark from './VerdictMark.svelte';

  const hillParam = $derived(page.url.searchParams.get('hill'));
  const zoneParam = $derived(page.url.searchParams.get('zone'));
  const ranking = $derived(conditions.ranking);

  const hillResult = $derived(hillParam ? ranking.hillsByNumber.get(Number(hillParam)) : undefined);
  const zoneResult = $derived(
    hillResult
      ? ranking.zones.find((z) => z.zone.id === hillResult.zone.id)
      : zoneParam
        ? ranking.zones.find((z) => z.zone.id === zoneParam)
        : undefined,
  );
  const result = $derived(hillResult?.result ?? zoneResult?.result);
  const open = $derived(Boolean(hillParam || zoneParam));
  const forecasts = $derived(zoneResult ? conditions.forecastsFor(zoneResult.zone.id) : []);
  const key = $derived(result ? keyHourProfile(result, forecasts) : null);
  const reasons = $derived(result ? explain(result, { wind: settings.wind }, modelLabel) : []);
  const reference = $derived(result?.byModel.find((m) => m.model === result.referenceModel));
  const lists = $derived(
    hillResult && conditions.data
      ? conditions.data.lists.filter((l) => hillIsOnList(hillResult.hill, l)).map((l) => l.label)
      : [],
  );
  const destination = $derived(
    hillResult ? { lat: hillResult.hill.lat, lon: hillResult.hill.lon } : zoneResult?.zone.forecastPoint,
  );
  const title = $derived(hillResult?.hill.name ?? zoneResult?.zone.name ?? '');
  const trip = $derived(hillResult ? hillResult.trip : zoneResult?.trip ?? null);
  const dayStart = $derived(londonMidnight(settings.dayOffset, conditions.now));
  const clock = (ms: number) => formatClock(ms, dayStart);

  let dialog: HTMLDialogElement | undefined = $state();

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });

  function close() {
    const url = new URL(page.url.href);
    url.searchParams.delete('hill');
    url.searchParams.delete('zone');
    goto(url, { replace: true, reset: false });
  }

  const STATUS_WORD = { good: 'Good', ok: 'Fair', poor: 'Poor', blocked: 'Blocks', nodata: 'No data', info: 'Note' };
</script>

<dialog bind:this={dialog} onclose={close} aria-labelledby="sheet-title">
  {#if open}
    <header>
      <div>
        <h2 id="sheet-title">{title}</h2>
        {#if hillResult}
          <p class="muted small">
            {Math.round(hillResult.hill.metres)} m{#if lists.length}, {lists.join(', ')}{/if}. {hillResult.zone.name}.
          </p>
        {:else if zoneResult}
          <p class="muted small">Forecast for the valley at {Math.round(forecasts[0]?.groundElevationM ?? 0)} m.</p>
        {/if}
      </div>
      <button class="close" onclick={() => dialog?.close()} aria-label="Close">×</button>
    </header>

    {#if !result || !zoneResult}
      <p class="muted">
        No result for this {hillParam ? 'hill' : 'zone'} with the current profile, day and filters.
      </p>
    {:else}
      <section class="verdict">
        <VerdictMark verdict={result.verdict} confidence={result.confidence} size="large" />
        <p class="small muted">
          {zoneResult.window.label}: {formatTime(zoneResult.window.start)} to {formatTime(zoneResult.window.end)}.
          {#if reference?.keyHour}Key hour {formatTime(reference.keyHour.time)}.{/if}
        </p>
      </section>
      <section class="plan">
        <h3>Your trip</h3>
        {#if trip}
          <ol class="timeline">
            <li><span class="t">{clock(trip.plan.wakeAt)}</span> Get up</li>
            <li class="leave"><span class="t">{clock(trip.plan.leaveAt)}</span> Leave {settings.start?.label === settings.home?.label && settings.home ? 'home' : settings.start?.label}</li>
            <li><span class="t">{clock(trip.plan.parkAt)}</span> Park, after about {formatDuration(trip.driveMinutes)} and {Math.round(trip.roadMiles)} miles</li>
            <li><span class="t">{clock(trip.plan.arriveAt)}</span> In place, after a {formatDuration(trip.walkMinutes)} {hillResult ? 'walk up' : 'walk'}</li>
            <li><span class="t">{clock(trip.plan.target)}</span> {trip.targetLabel.charAt(0).toUpperCase() + trip.targetLabel.slice(1)}</li>
          </ol>
          {#if trip.problem === 'too-early'}
            <p class="small warn">That means getting up before {settings.earliestUp}.</p>
          {:else if trip.problem === 'too-late'}
            <p class="small warn">You’d already need to have left.</p>
          {/if}
          <p class="small muted">
            Rough estimates: the drive from straight-line distance with typical road speeds, the walk
            {hillResult ? 'by Naismith’s rule from the valley floor' : 'a short stroll from parking'}. Check the
            real route below.
          </p>
        {:else}
          <p class="small muted">Set a start point or <a href="/settings#home">your home</a> to see when to leave.</p>
        {/if}
      </section>


      <section>
        <h3>Why</h3>
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

      {#if reference}
        <section>
          <h3>Hour by hour ({modelLabel(reference.model)})</h3>
          <HourStrip window={reference} keyTime={reference.keyHour?.time ?? null} />
        </section>
      {/if}

      {#if key}
        <section>
          <h3>The air above the valley at {formatTime(key.forecast.time[key.index]!)}</h3>
          <AirColumn
            forecast={key.forecast}
            index={key.index}
            summitM={hillResult ? hillResult.hill.metres : null}
            summitName={hillResult?.hill.name ?? ''}
          />
        </section>
      {/if}

      <section class="sun">
        <h3>Sun</h3>
        <dl>
          {#each [['Dawn', zoneResult.sun.civilDawn], ['Golden hour', zoneResult.sun.goldenStart], ['Sunrise', zoneResult.sun.sunrise], ['Sunset', zoneResult.sun.sunset], ['Blue hour', zoneResult.sun.eveningBlueStart], ['Dusk', zoneResult.sun.civilDusk]] as const as [label, t] (label)}
            <div><dt>{label}</dt><dd>{t ? formatTime(t) : 'none'}</dd></div>
          {/each}
        </dl>
      </section>

      <section class="links">
        {#if destination}
          <a class="button" href={googleMapsDirectionsUrl(destination, settings.start ?? undefined)} target="_blank" rel="noopener">
            Directions in Google Maps
          </a>
        {/if}
        {#if hillResult?.miles != null}
          <span class="small muted">{Math.round(hillResult.miles)} miles in a straight line</span>
        {/if}
        <p class="small">
          {#if hillResult}
            <a href="https://www.hill-bagging.co.uk/mountaindetails.php?rf={hillResult.hill.number}" target="_blank" rel="noopener">Hill details on Hill Bagging</a>.
          {/if}
          Before you go, check the <a href="https://www.metoffice.gov.uk/weather/specialist-forecasts/mountain" target="_blank" rel="noopener">Met Office mountain forecast</a>
          and <a href="https://www.mwis.org.uk/" target="_blank" rel="noopener">MWIS</a>.
        </p>
      </section>
    {/if}
  {/if}
</dialog>

<style>
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
