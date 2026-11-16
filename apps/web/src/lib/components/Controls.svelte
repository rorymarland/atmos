<script lang="ts">
  /** Profile, day and light; the trip plan (start, moment, limits); and hill filters. */
  import { formatDuration } from '@atmos/engine';
  import { conditions } from '#lib/conditions.svelte.ts';
  import { settings } from '#lib/settings.svelte.ts';
  import { SUMMIT_PROFILES } from '#lib/static-data.ts';
  import { MOMENT_LABELS, lightFor, type Moment } from '#lib/sun.ts';
  import { dayLabel } from '#lib/time.ts';

  let {
    picking = false,
    onPickStart,
  }: { picking?: boolean; onPickStart?: () => void } = $props();

  const profiles = $derived(
    conditions.data
      ? Object.entries(conditions.data.config.profiles).map(([id, p]) => ({ id, label: p.label }))
      : [],
  );
  const days = [0, 1, 2, 3, 4];
  const showLight = $derived(!SUMMIT_PROFILES.has(settings.profile));
  const light = $derived(lightFor(settings.profile, settings.light));
  const isWalking = $derived(settings.profile === 'walking');
  const lists = $derived(conditions.data?.lists ?? []);
  const moments: Moment[] = ['blue', 'golden', 'sun'];
  const upTimes = ['03:00', '03:30', '04:00', '04:30', '05:00', '05:30', '06:00', '06:30', '07:00', '08:00', '09:00'];
  const drives = [30, 45, 60, 90, 120, 150, 180, 240];

  const atHome = $derived(
    Boolean(settings.home && settings.start && settings.home.lat === settings.start.lat && settings.home.lon === settings.start.lon),
  );

  /** The plan read back as a sentence. */
  const summary = $derived.by(() => {
    const day = dayLabel(settings.dayOffset);
    const when = isWalking ? '' : ` ${light === 'sunrise' ? 'morning' : 'evening'}`;
    const parts = [`${day}${when}`];
    if (!isWalking) parts.push(`for ${MOMENT_LABELS[light][settings.moment].toLowerCase()}`);
    if (settings.start && settings.earliestUp) parts.push(`up no earlier than ${settings.earliestUp}`);
    if (settings.start && settings.maxDriveMinutes) parts.push(`no more than ${formatDuration(settings.maxDriveMinutes)} in the car`);
    if (settings.start) parts.push(`from ${atHome ? 'home' : settings.start.label}`);
    return parts.join(', ') + '.';
  });

  let locating = $state(false);
  let locateError = $state<string | null>(null);

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
  <p class="summary">{summary}</p>

  <div class="chips wrap" role="group" aria-label="What are you going for?">
    {#each profiles as p (p.id)}
      <button class="chip" aria-pressed={settings.profile === p.id} onclick={() => (settings.profile = p.id)}>
        {p.label}
      </button>
    {/each}
  </div>

  <div class="chips wrap" role="group" aria-label="Day">
    {#each days as d (d)}
      <button class="chip" aria-pressed={settings.dayOffset === d} onclick={() => (settings.dayOffset = d)}>
        {dayLabel(d)}
      </button>
    {/each}
    {#if showLight}
      <span class="sep" aria-hidden="true"></span>
      <button class="chip light" aria-pressed={settings.light === 'sunrise'} onclick={() => (settings.light = 'sunrise')}>Morning</button>
      <button class="chip light" aria-pressed={settings.light === 'sunset'} onclick={() => (settings.light = 'sunset')}>Evening</button>
    {/if}
  </div>

  <fieldset class="plan">
    <legend>Your trip</legend>

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

    {#if !isWalking}
      <div class="row">
        <span class="label">Be there for</span>
        <div class="chips" role="group" aria-label="Be there for">
          {#each moments as m (m)}
            <button class="chip" aria-pressed={settings.moment === m} onclick={() => (settings.moment = m)}>
              {MOMENT_LABELS[light][m]}
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
      <select bind:value={settings.maxDriveMinutes} disabled={!settings.start}>
        <option value={null}>Any distance</option>
        {#each drives as d (d)}<option value={d}>{formatDuration(d)}</option>{/each}
      </select>
    </label>
  </fieldset>

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
  .wrap {
    flex-wrap: wrap;
    overflow: visible;
  }
  .sep {
    flex: none;
    width: 1px;
    background: var(--line);
    margin: 3px 2px;
  }
  .chip.light[aria-pressed='true'] {
    background: var(--gold);
    border-color: var(--gold);
    color: #1b2731;
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
  legend {
    padding: 0 4px;
    font-size: 0.85rem;
    color: var(--ink-soft);
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
