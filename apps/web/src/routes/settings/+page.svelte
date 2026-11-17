<script lang="ts">
  import { clearForecastCache } from '#lib/cache.ts';
  import { findPlace } from '#lib/geocode.ts';
  import {
    DEFAULT_SETTINGS,
    exportSettings,
    importSettings,
    settings,
    type StartPoint,
  } from '#lib/settings.svelte.ts';

  let query = $state('');
  let searching = $state(false);
  let found = $state<StartPoint[] | null>(null);

  async function search(e: SubmitEvent) {
    e.preventDefault();
    message = null;
    searching = true;
    try {
      found = await findPlace(query);
      if (found.length === 0) message = `Nothing found for “${query}”. Try a full postcode or a town name.`;
    } catch (err) {
      message = `${(err as Error).message}. Check your connection and try again.`;
      found = null;
    } finally {
      searching = false;
    }
  }

  function setHome(p: StartPoint) {
    const wasHome =
      !settings.start ||
      (settings.home && settings.start.lat === settings.home.lat && settings.start.lon === settings.home.lon);
    settings.home = { ...p };
    if (wasHome) settings.start = { ...p };
    found = null;
    query = '';
    message = `Home set to ${p.label}.`;
  }

  let message = $state<string | null>(null);
  let latText = $state(settings.start ? String(settings.start.lat) : '');
  let lonText = $state(settings.start ? String(settings.start.lon) : '');

  function useLocation() {
    message = null;
    if (!('geolocation' in navigator)) {
      message = 'This browser can’t share its location. Enter coordinates instead.';
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Math.round(pos.coords.latitude * 1e4) / 1e4;
        const lon = Math.round(pos.coords.longitude * 1e4) / 1e4;
        settings.start = { lat, lon, label: 'your location' };
        latText = String(lat);
        lonText = String(lon);
        message = 'Start point set to your current location.';
      },
      (err) => {
        message =
          err.code === err.PERMISSION_DENIED
            ? 'Location permission was refused. Browsers only allow it on secure (https) sites; enter coordinates instead, or right-click on the map.'
            : 'Couldn’t get your location. Enter coordinates instead.';
      },
      { timeout: 10_000 },
    );
  }

  function saveCoords() {
    const lat = Number(latText);
    const lon = Number(lonText);
    if (!(lat >= 49.8 && lat <= 61 && lon >= -8.7 && lon <= 2)) {
      message = 'Enter a UK latitude (49.8 to 61) and longitude (−8.7 to 2), e.g. 55.9533 and −3.1883.';
      return;
    }
    settings.start = { lat, lon, label: 'your chosen point' };
    message = 'Start point saved.';
  }

  function clearStart() {
    settings.start = null;
    settings.maxDriveMiles = null;
    latText = '';
    lonText = '';
    message = 'Start point cleared.';
  }

  function download() {
    const blob = new Blob([exportSettings()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'atmos-settings.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function upload(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      importSettings(await file.text());
      message = 'Settings imported.';
    } catch (err) {
      message = `Couldn’t import that file: ${(err as Error).message}.`;
    }
  }
</script>

<svelte:head><title>Atmos: settings</title></svelte:head>

<div class="page">
  <h1>Settings</h1>
  <p class="muted">Saved in this browser only.</p>

  {#if message}<p class="message" role="status">{message}</p>{/if}

  <section>
    <h2>Display</h2>
    <fieldset>
      <legend>Theme</legend>
      <label><input type="radio" bind:group={settings.theme} value="light" /> Light</label>
      <label><input type="radio" bind:group={settings.theme} value="dark" /> Dark</label>
    </fieldset>
    <fieldset>
      <legend>Wind speed</legend>
      <label><input type="radio" bind:group={settings.wind} value="kmh" /> km/h</label>
      <label><input type="radio" bind:group={settings.wind} value="mph" /> mph</label>
    </fieldset>
  </section>

  <section id="home">
    <h2>Home</h2>
    <p class="small muted">
      Where trips usually start, for leave times and drive limits. A postcode or town is enough;
      only the coordinates are kept, in this browser.
    </p>
    {#if settings.home}
      <p>Home is <strong>{settings.home.label}</strong>.
        <button class="link" onclick={() => { settings.home = null; message = 'Home cleared.'; }}>Clear</button></p>
    {/if}
    <form class="row search" onsubmit={search}>
      <label>Postcode or place <input bind:value={query} placeholder="EH1 1YZ or Peebles" autocomplete="postal-code" /></label>
      <button class="button" disabled={searching || !query.trim()}>{searching ? 'Searching…' : 'Find'}</button>
    </form>
    {#if found && found.length}
      <ul class="found">
        {#each found as f (f.lat + ',' + f.lon)}
          <li><button class="link" onclick={() => setHome(f)}>{f.label}</button> <span class="small muted">{f.lat}, {f.lon}</span></li>
        {/each}
      </ul>
    {/if}
  </section>

  <section>
    <h2>Trip timings</h2>
    <p class="small muted">Used to work out when to get up and leave. All estimates.</p>
    <label class="field">Getting ready
      <select bind:value={settings.readyMinutes}>
        {#each [10, 15, 20, 30, 45, 60] as m (m)}<option value={m}>{m} min</option>{/each}
      </select>
    </label>
    <label class="field">Be in place early by
      <select bind:value={settings.earlyMinutes}>
        {#each [0, 10, 15, 20, 30, 45, 60] as m (m)}<option value={m}>{m} min</option>{/each}
      </select>
    </label>
    <label class="field">Walking pace
      <select bind:value={settings.pace}>
        <option value="relaxed">Relaxed (with a heavy camera bag)</option>
        <option value="steady">Steady (Naismith’s rule)</option>
        <option value="brisk">Brisk</option>
      </select>
    </label>
  </section>

  <section>
    <h2>Start point for today</h2>
    <p class="small muted">
      Usually home. Change it when you’re setting off from somewhere else; it stays until you change
      it back.
    </p>
    {#if settings.start}
      <p>Currently {settings.start.label}: {settings.start.lat}, {settings.start.lon}.</p>
    {/if}
    <div class="row">
      {#if settings.home}<button class="button quiet" onclick={() => { settings.start = { ...settings.home! }; message = 'Starting from home.'; }}>Use home</button>{/if}
      <button class="button" onclick={useLocation}>Use my location</button>
      {#if settings.start}<button class="button quiet" onclick={clearStart}>Clear start point</button>{/if}
    </div>
    <div class="row coords">
      <label>Latitude <input inputmode="decimal" bind:value={latText} placeholder="55.9533" /></label>
      <label>Longitude <input inputmode="decimal" bind:value={lonText} placeholder="-3.1883" /></label>
      <button class="button quiet" onclick={saveCoords}>Save coordinates</button>
    </div>
  </section>

  <section>
    <h2>Back up and move</h2>
    <p class="small muted">Copy your settings between the Mac and your phone with a file.</p>
    <div class="row">
      <button class="button quiet" onclick={download}>Export settings</button>
      <label class="button quiet file">Import settings <input type="file" accept="application/json" onchange={upload} /></label>
    </div>
  </section>

  <section>
    <h2>Data</h2>
    <div class="row">
      <button
        class="button quiet"
        onclick={async () => {
          await clearForecastCache();
          message = 'Saved forecasts cleared. Fresh ones load on the next visit to Today or Map.';
        }}>Clear saved forecasts</button
      >
      <button
        class="button quiet"
        onclick={() => {
          Object.assign(settings, DEFAULT_SETTINGS);
          message = 'Settings reset to defaults.';
        }}>Reset settings</button
      >
    </div>
  </section>
</div>

<style>
  .page {
    max-width: 680px;
    margin: 0 auto;
    padding: 24px 20px 40px;
    display: grid;
    gap: 22px;
  }
  section {
    display: grid;
    gap: 10px;
    padding-top: 18px;
    border-top: 1px solid var(--line);
  }
  fieldset {
    border: none;
    padding: 0;
    margin: 0;
    display: flex;
    gap: 16px;
    align-items: center;
  }
  legend {
    float: left;
    width: 7em;
    color: var(--ink-soft);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: flex-end;
  }
  .field {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .field select {
    padding: 4px 8px;
    border-radius: 6px;
    border: 1px solid var(--line);
    background: var(--surface);
  }
  .search label {
    display: grid;
    gap: 2px;
    font-size: 0.85rem;
    color: var(--ink-soft);
  }
  .search input {
    width: 16em;
    padding: 6px 8px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--surface);
  }
  .found {
    margin: 0;
    padding-left: 1.1em;
    display: grid;
    gap: 4px;
  }
  .link {
    border: none;
    background: none;
    padding: 0;
    text-decoration: underline;
    color: var(--ink);
  }
  .coords label {
    display: grid;
    gap: 2px;
    font-size: 0.85rem;
    color: var(--ink-soft);
  }
  .coords input {
    width: 9em;
    padding: 6px 8px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--surface);
  }
  .message {
    border-left: 3px solid var(--gold);
    padding-left: 10px;
  }
  .file input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
  }
  .file:focus-within {
    outline: 2px solid var(--focus);
  }
</style>
