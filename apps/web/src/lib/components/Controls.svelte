<script lang="ts">
  /** Day, what to look for and when; the trip plan (start, moment, limits); hill filters. */
  import { NATION_LABELS, type Nation } from '@atmos/engine';
  import { conditions } from '#lib/conditions.svelte.ts';
  import { settings } from '#lib/settings.svelte.ts';
  import { MOMENT_LABELS, PERIOD_LABELS, type Moment, type Period } from '#lib/sun.ts';
  import { dayLabel } from '#lib/time.ts';
  import { CONDITION_GROUPS } from '#lib/groups.ts';
  import { DOWN_BY_LABELS, type DownBy } from '#lib/walk.ts';

  let {
    picking = false,
    onPickStart,
  }: { picking?: boolean; onPickStart?: () => void } = $props();

  const GROUPS = CONDITION_GROUPS;
  const ALL_PERIODS: Period[] = ['morning', 'day', 'evening', 'night'];

  const profiles = $derived(conditions.data?.config.profiles ?? {});
  const groups = $derived(
    GROUPS.map((g) => ({ ...g, ids: g.ids.filter((id) => profiles[id]) })).filter((g) => g.ids.length),
  );
  const ticked = $derived(conditions.ticked);
  const days = [0, 1, 2, 3, 4];
  const lists = $derived(conditions.data?.lists ?? []);
  const moments: Moment[] = ['blue', 'golden', 'sunrise', 'sunset'];
  const upTimes = ['03:00', '03:30', '04:00', '04:30', '05:00', '05:30', '06:00', '06:30', '07:00', '08:00', '09:00'];
  const driveMiles = [10, 20, 30, 50, 75, 100, 150, 200, 300];
  const lightPeriods = $derived(settings.periods.filter((p) => p === 'morning' || p === 'evening'));
  // "Be there for" is about light for photos: a walk has its own timing.
  const walking = $derived(ticked.has('walking'));
  const photoTicked = $derived([...ticked].some((id) => id !== 'walking'));
  const showMoment = $derived(lightPeriods.length > 0 && photoTicked);
  const walkStarts = Array.from({ length: 21 }, (_, i) => {
    const m = 5 * 60 + i * 30;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${m % 60 ? '30' : '00'}`;
  });
  const downBys: DownBy[] = ['sunset', 'dark', 'any'];

  const atHome = $derived(
    Boolean(settings.home && settings.start && settings.home.lat === settings.start.lat && settings.home.lon === settings.start.lon),
  );

  /** The search read back as a sentence. */
  const summary = $derived.by(() => {
    const day = dayLabel(settings.dayOffset);
    const when =
      settings.periods.length === ALL_PERIODS.length
        ? ''
        : ` ${settings.periods.map((p) => PERIOD_LABELS[p].toLowerCase()).join(' or ')}`;
    const n = ticked.size;
    const what =
      n === 0 ? 'nothing ticked' : n === 1 ? conditions.label([...ticked][0]!).toLowerCase() : `${n} conditions`;
    const where = settings.countries.length ? ` in ${settings.countries.map((c) => NATION_LABELS[c]).join(' or ')}` : '';
    // "Today night" reads oddly: say "Tonight".
    const dayWhen = settings.dayOffset === 0 && when === ' night' ? 'Tonight' : `${day}${when}`;
    const parts = [`${dayWhen}${where}, ${what}`];
    if (showMoment) parts.push(`there for ${MOMENT_LABELS[settings.moment].toLowerCase()}`);
    if (walking) {
      parts.push(settings.walkStart === 'best' ? 'walking in the best weather' : `setting off walking at ${settings.walkStart}`);
      if (settings.downBy !== 'any') parts.push(`down ${DOWN_BY_LABELS[settings.downBy].toLowerCase()}`);
    }
    if (settings.start && settings.earliestUp) parts.push(`up no earlier than ${settings.earliestUp}`);
    if (settings.start && settings.maxDriveMiles) parts.push(`within ${settings.maxDriveMiles} miles’ drive`);
    if (settings.start) parts.push(`from ${atHome ? 'home' : settings.start.label}`);
    return parts.join(', ') + '.';
  });

  /** Section open states, remembered in this browser. */
  function remembered(key: string, fallback: boolean): boolean {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v === '1';
    } catch {
      return fallback;
    }
  }
  let lookOpen = $state(remembered('atmos.lookOpen', true));
  let tripOpen = $state(remembered('atmos.tripOpen', true));
  $effect(() => {
    try {
      localStorage.setItem('atmos.lookOpen', lookOpen ? '1' : '0');
      localStorage.setItem('atmos.tripOpen', tripOpen ? '1' : '0');
    } catch {
      // Not remembered: fine.
    }
  });

  let locating = $state(false);
  let locateError = $state<string | null>(null);

  const NATIONS = Object.keys(NATION_LABELS) as Nation[];
  function toggleCountry(n: Nation) {
    const has = settings.countries.includes(n);
    const next = has ? settings.countries.filter((x) => x !== n) : [...settings.countries, n];
    // All four ticked is the same as the whole UK.
    settings.countries = next.length === NATIONS.length ? [] : next;
  }

  function toggleCondition(id: string) {
    const next = new Set(ticked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    settings.conditions = [...next];
  }
  function setAll(on: boolean) {
    // All is the default set (photo conditions and walking): stored as null like a reset.
    settings.conditions = on ? null : [];
  }
  function togglePeriod(p: Period) {
    const has = settings.periods.includes(p);
    settings.periods = has ? settings.periods.filter((x) => x !== p) : ALL_PERIODS.filter((x) => x === p || settings.periods.includes(x));
  }

  function toggleList(id: string) {
    const all = lists.map((l) => l.id);
    const current = settings.lists.length ? settings.lists : all;
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    settings.lists = next.length === all.length || next.length === 0 ? [] : next;
  }
  const listOn = (id: string) => settings.lists.length === 0 || settings.lists.includes(id);

  function useLocation() {
    locateError = null;
    if (!('geolocation' in navigator)) {
      locateError = 'This browser can’t share its location. Pick a point on the map instead.';
      return;
    }
    locating = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        locating = false;
        settings.start = {
          lat: Math.round(pos.coords.latitude * 1e4) / 1e4,
          lon: Math.round(pos.coords.longitude * 1e4) / 1e4,
          label: 'your location',
        };
      },
      (err) => {
        locating = false;
        locateError =
          err.code === err.PERMISSION_DENIED
            ? 'Location was refused (browsers only share it with https sites). Pick a point on the map instead.'
            : 'Couldn’t get your location. Pick a point on the map instead.';
      },
      { timeout: 10_000 },
    );
  }
</script>

<div class="controls">
  <div class="summary-row">
    <p class="summary">{summary}</p>

  </div>

  <div class="chips wrap" role="group" aria-label="Day">
    {#each days as d (d)}
      <button class="chip" aria-pressed={settings.dayOffset === d} onclick={() => (settings.dayOffset = d)}>
        {dayLabel(d)}
      </button>
    {/each}
  </div>

  <div class="chips wrap" role="group" aria-label="Country">
    <button class="chip" aria-pressed={settings.countries.length === 0} onclick={() => (settings.countries = [])}>All UK</button>
    {#each NATIONS as n (n)}
      <button class="chip" aria-pressed={settings.countries.includes(n)} onclick={() => toggleCountry(n)}>{NATION_LABELS[n]}</button>
    {/each}
  </div>

  <details class="look" bind:open={lookOpen}>
    <summary>Look for <span class="small muted">{ticked.size} ticked, {settings.periods.length === 4 ? 'any time' : settings.periods.map((p) => PERIOD_LABELS[p].toLowerCase()).join(', ')}</span></summary>
    <div class="section-body">
    <div class="quick small">
      <button class="link" onclick={() => setAll(true)}>All</button>
      <button class="link" onclick={() => setAll(false)}>None</button>
    </div>
    {#each groups as g (g.label)}
      <div class="group">
        <span class="group-label small">{g.label}</span>
        <div class="ticks">
          {#each g.ids as id (id)}
            <label class="tick" title={profiles[id]?.blurb}>
              <input type="checkbox" checked={ticked.has(id)} onchange={() => toggleCondition(id)} />
              {profiles[id]?.short}
            </label>
          {/each}
          {#if g.ids.includes('aurora')}
            <label
              class="tick"
              title="Show the aurora model on the map: NOAA's OVATION nowcast for tonight and a view line from the Kp forecast"
            >
              <input type="checkbox" bind:checked={settings.ovation} disabled={!ticked.has('aurora')} />
              Ovation
            </label>
          {/if}
        </div>
      </div>
    {/each}
    <div class="group">
      <span class="group-label small">When</span>
      <div class="ticks">
        {#each ALL_PERIODS as p (p)}
          <label class="tick">
            <input type="checkbox" checked={settings.periods.includes(p)} onchange={() => togglePeriod(p)} />
            {PERIOD_LABELS[p]}
          </label>
        {/each}
      </div>
    </div>
  </div>
  </details>

<details class="plan" bind:open={tripOpen}>
    <summary>Your trip <span class="small muted">{settings.start ? `from ${atHome ? 'home' : settings.start.label}` : 'no start point'}</span></summary>
    <div class="section-body">

    <div class="row">
      <span class="label">From</span>
      <span class="value">
        {#if settings.start}{atHome ? `Home (${settings.start.label})` : settings.start.label}{:else}<span class="muted">not set: no leave times</span>{/if}
      </span>
    </div>
    <div class="actions">
      {#if settings.home && !atHome}
        <button class="link" onclick={() => (settings.start = settings.home ? { ...settings.home } : null)}>Use home</button>
      {/if}
      {#if !settings.home}<a class="link" href="/settings#home">Set home</a>{/if}
      <button class="link" onclick={useLocation} disabled={locating}>{locating ? 'Locating…' : 'Use my location'}</button>
      {#if onPickStart}
        <button class="link" onclick={onPickStart} aria-pressed={picking}>{picking ? 'Click the map…' : 'Pick on map'}</button>
      {/if}
    </div>
    {#if locateError}<p class="small error">{locateError}</p>{/if}

    {#if walking}
      <label class="row">
        <span class="label">Start walking</span>
        <select bind:value={settings.walkStart} title="When to set off from the car on a hill walk">
          <option value="best">When the weather's best</option>
          {#each walkStarts as t (t)}<option value={t}>At {t}</option>{/each}
        </select>
      </label>
      <div class="row">
        <span class="label">Down by</span>
        <div class="chips" role="group" aria-label="Back at the car">
          {#each downBys as d (d)}
            <button class="chip" aria-pressed={settings.downBy === d} onclick={() => (settings.downBy = d)}>
              {DOWN_BY_LABELS[d]}
            </button>
          {/each}
        </div>
      </div>
      {#if settings.downBy !== 'sunset'}
        <p class="small muted note">Walks may finish after sunset: you'll be told when to take a head torch.</p>
      {/if}
    {/if}

    {#if showMoment}
      <div class="row">
        <span class="label">Be there for</span>
        <div class="chips" role="group" aria-label="At dawn and dusk, be there for">
          {#each moments as m (m)}
            <button class="chip" aria-pressed={settings.moment === m} onclick={() => (settings.moment = m)}>
              {MOMENT_LABELS[m]}
            </button>
          {/each}
        </div>
      </div>
    {/if}

    <label class="row">
      <span class="label">Up no earlier than</span>
      <select bind:value={settings.earliestUp} disabled={!settings.start}>
        <option value={null}>Any time</option>
        {#each upTimes as t (t)}<option value={t}>{t}</option>{/each}
      </select>
    </label>

    <label class="row">
      <span class="label">Drive up to</span>
      <select bind:value={settings.maxDriveMiles} disabled={!settings.start} title="Estimated road miles from the start point">
        <option value={null}>Any distance</option>
        {#each driveMiles as d (d)}<option value={d}>{d} miles</option>{/each}
      </select>
    </label>

    {#if photoTicked}
      <label class="row">
        <span class="label">Be in place early by</span>
        <select bind:value={settings.earlyMinutes}>
          {#each [0, 10, 15, 20, 30, 45, 60] as m (m)}<option value={m}>{m} min</option>{/each}
        </select>
      </label>
    {/if}
  </div>
  </details>

  <details class="filters">
    <summary>Hill filters{#if settings.lists.length || settings.minHeight}<span class="dot" aria-label="(active)"></span>{/if}</summary>
    <div class="filter-body">
      <div class="chips wrap" role="group" aria-label="Hill lists">
        {#each lists as l (l.id)}
          <button class="chip" aria-pressed={listOn(l.id)} onclick={() => toggleList(l.id)}>{l.label}</button>
        {/each}
      </div>
      <label class="row">
        <span class="label">Lowest summit</span>
        <select bind:value={settings.minHeight}>
          {#each [0, 300, 500, 600, 762, 900, 1000] as m (m)}
            <option value={m}>{m === 0 ? 'Any height' : `${m} m`}</option>
          {/each}
        </select>
      </label>
    </div>
  </details>
</div>

<style>
  .controls {
    display: grid;
    gap: 10px;
  }
  .summary {
    font-weight: 650;
    font-stretch: 88%;
    line-height: 1.35;
  }
  .summary-row {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    justify-content: space-between;
  }
  .look {
    margin: 0;
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 6px 10px 10px;
    background: var(--surface);
    display: grid;
    gap: 8px;
  }
  .quick {
    display: flex;
    gap: 14px;
    margin-top: -2px;
  }
  .group {
    display: grid;
    grid-template-columns: 7.5em 1fr;
    gap: 2px 8px;
    align-items: baseline;
  }
  .group-label {
    color: var(--ink-soft);
  }
  .ticks {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 14px;
  }
  .tick {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 0.88rem;
    cursor: pointer;
    white-space: nowrap;
  }
  .tick:has(input:disabled) {
    opacity: 0.5;
    cursor: default;
  }
  .tick input {
    accent-color: var(--ink);
    margin: 0;
  }
  .wrap {
    flex-wrap: wrap;
    overflow: visible;
  }
  .plan {
    margin: 0;
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 8px 10px 10px;
    background: var(--surface);
    display: grid;
    gap: 7px;
  }
  /* Safari ignores display: grid on <details>, so the spacing lives on an inner box. */
  .section-body {
    display: grid;
    gap: 10px;
    padding-top: 8px;
  }
  .look > summary,
  .plan > summary {
    cursor: pointer;
    font-size: 0.9rem;
    font-weight: 650;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    font-size: 0.9rem;
  }
  .label {
    min-width: 8.5em;
    color: var(--ink-soft);
  }
  .value {
    font-weight: 600;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    margin: -2px 0 2px;
  }
  .link {
    border: none;
    background: none;
    padding: 0;
    font-size: 0.85rem;
    text-decoration: underline;
    text-underline-offset: 0.18em;
    color: var(--ink);
  }
  .link[aria-pressed='true'] {
    color: var(--focus);
    font-weight: 650;
  }
  .error {
    color: var(--no);
  }
  .note {
    margin: -4px 0 0;
  }
  .filters summary {
    cursor: pointer;
    color: var(--ink-soft);
    font-size: 0.9rem;
    width: fit-content;
  }
  .dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--gold);
    margin-left: 6px;
    vertical-align: 1px;
  }
  .filter-body {
    display: grid;
    gap: 10px;
    padding: 10px 0 2px;
  }
  select {
    padding: 4px 8px;
    border-radius: 6px;
    border: 1px solid var(--line);
    background: var(--paper);
  }
</style>
