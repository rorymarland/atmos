<script lang="ts">
  import { startCheck } from '#lib/check-page.js';

  let root: HTMLElement;
  $effect(() => startCheck(root));
</script>

<svelte:head><title>Atmos: data check</title></svelte:head>

<div class="page check" bind:this={root}>
  <h1>Data check</h1>

  <h2>Shared forecasts</h2>
  <p>
    The Atmos server (the alerts container) pulls the forecasts for everyone, so browsers don't
    each use up Open-Meteo's daily allowance. This updates itself every 30 seconds.
  </p>
  <div id="shared"><p class="muted">Loading…</p></div>

  <h2>Air traffic</h2>
  <p>
    For plane trails, the Atmos server samples aircraft above 25,000 ft over the UK from the
    OpenSky Network every 12 minutes, building up a picture of when and where they fly. It
    needs a few weeks of samples before it's used for trail risk.
  </p>
  <div id="traffic"><p class="muted">Loading…</p></div>

  <h2>Terrain detail</h2>
  <p>
    The viewer, Line it up and the walking routes use Mapterhorn's terrain tiles. This asks for one
    tile at each zoom over four hills, to show how fine the terrain is here: zoom 15 is about
    1.4 m a pixel in Scotland. It downloads a few MB, so it only runs when you ask.
  </p>
  <div class="row"><button id="terrain-run">Test terrain detail</button></div>
  <div id="terrain"></div>

  <h2>Browser API check</h2>
  <p>
    Calls each data source the way the app will, straight from this browser, and records what
    comes back. It takes about a minute, and uses a few dozen of today's Open-Meteo calls from
    this connection. When it finishes, press <strong>Copy results</strong> and paste them into
    the chat.
  </p>
  <div class="row">
    <button id="run">Run checks</button>
    <button id="copy" class="secondary" disabled>Copy results</button>
    <span id="status"></span>
  </div>
  <table>
    <thead>
      <tr>
        <th>Check</th>
        <th>Result</th>
        <th>Detail</th>
      </tr>
    </thead>
    <tbody id="rows"></tbody>
  </table>
  <textarea id="out" readonly placeholder="Results appear here"></textarea>

</div>

<style>
  .page {
    max-width: 960px;
    margin: 0 auto;
    padding: 24px 20px 64px;
  }
  /* Most of this page is drawn by check-page.js, outside Svelte's scoping. */
  .check :global(h1) {
    font-size: 1.4rem;
    margin: 0 0 4px;
  }
  .check :global(h2) {
    font-size: 1.15rem;
    margin: 28px 0 4px;
  }
  .check :global(p) {
    color: var(--ink-soft);
    margin: 0 0 14px;
    max-width: 75ch;
  }
  .check :global(button) {
    font: inherit;
    padding: 9px 16px;
    border-radius: 8px;
    border: 1px solid var(--ink);
    background: var(--ink);
    color: var(--surface);
    cursor: pointer;
  }
  .check :global(button.secondary) {
    background: transparent;
    color: var(--ink);
  }
  .check :global(button:disabled) {
    opacity: 0.5;
    cursor: default;
  }
  .check :global(table) {
    width: 100%;
    border-collapse: collapse;
    margin: 16px 0;
    font-size: 0.9rem;
  }
  .check :global(th),
  .check :global(td) {
    text-align: left;
    padding: 6px 8px;
    border-bottom: 1px solid var(--line);
    vertical-align: top;
  }
  .check :global(th) {
    color: var(--ink-soft);
    font-weight: 600;
  }
  .check :global(td.ok) {
    color: var(--go);
    font-weight: 600;
  }
  .check :global(td.partial),
  .check :global(td.warn) {
    color: var(--maybe);
    font-weight: 600;
  }
  .check :global(td.fail),
  .check :global(td.error) {
    color: var(--no);
    font-weight: 600;
  }
  .check :global(td.info),
  .check :global(.muted),
  .check :global(#status) {
    color: var(--ink-soft);
  }
  .check :global(textarea) {
    width: 100%;
    height: 220px;
    font: 12px/1.4 ui-monospace, Menlo, monospace;
    box-sizing: border-box;
    background: var(--surface);
    color: var(--ink);
    border: 1px solid var(--line);
    border-radius: 6px;
  }
  .check :global(.row) {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
  }
  .check :global(.banner) {
    padding: 10px 14px;
    border-radius: 8px;
    margin: 12px 0;
    font-weight: 600;
  }
  .check :global(.banner:not(.bad):not(.warn):not(.ok)) {
    background: color-mix(in srgb, var(--ink) 6%, transparent);
    font-weight: 400;
  }
  .check :global(.progress) {
    height: 6px;
    border-radius: 3px;
    background: color-mix(in srgb, var(--ink) 10%, transparent);
    overflow: hidden;
    margin: -4px 0 12px;
  }
  .check :global(.progress span) {
    display: block;
    height: 100%;
    background: var(--go);
  }
  .check :global(.banner.bad) {
    background: color-mix(in srgb, var(--no) 14%, transparent);
    color: var(--no);
  }
  .check :global(.banner.warn) {
    background: color-mix(in srgb, var(--maybe) 16%, transparent);
    color: var(--maybe);
  }
  .check :global(.banner.ok) {
    background: color-mix(in srgb, var(--go) 14%, transparent);
    color: var(--go);
  }
  .check :global(.meter) {
    height: 8px;
    border-radius: 4px;
    background: var(--line);
    overflow: hidden;
    margin: 6px 0 2px;
    max-width: 420px;
  }
  .check :global(.meter span) {
    display: block;
    height: 100%;
    background: var(--go);
  }
  .check :global(.meter span.warn) {
    background: var(--maybe);
  }
  .check :global(.meter span.bad) {
    background: var(--no);
  }
  .check :global(.bars) {
    display: flex;
    align-items: flex-end;
    gap: 3px;
    height: 90px;
    margin: 12px 0 2px;
    max-width: 620px;
  }
  .check :global(.bars span) {
    flex: 1;
    background: var(--ink-soft);
    opacity: 0.55;
    border-radius: 2px 2px 0 0;
    min-height: 1px;
  }
  .check :global(.bars span.none) {
    background: var(--line);
    opacity: 1;
  }
  .check :global(.bar-labels) {
    display: flex;
    gap: 3px;
    max-width: 620px;
    font-size: 0.7rem;
    color: var(--ink-soft);
  }
  .check :global(.bar-labels span) {
    flex: 1;
  }
  .check :global(.nowrap) {
    white-space: nowrap;
  }
</style>
