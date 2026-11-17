<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';
  import { onMount, untrack } from 'svelte';
  import { conditions } from '#lib/conditions.svelte.ts';
  import { settings, watchSettings } from '#lib/settings.svelte.ts';
  import { alerts } from '#lib/alerts.svelte.ts';

  let { children } = $props();

  watchSettings();

  onMount(() => {
    conditions.init();
    // The Alerts link only shows when the alerts container is running.
    void alerts.probe();
  });

  // Fetch whenever the set of zones the filters need changes. Cached zones cost nothing.
  // Only the zone list is tracked: refresh() reads its own loading flag, which must not
  // re-trigger this effect.
  $effect(() => {
    const zones = conditions.neededZones;
    if (zones.length > 0) untrack(() => conditions.refresh());
  });

  // The aurora nowcast: when the aurora is ticked for tonight, then every ten minutes.
  $effect(() => {
    if (!conditions.auroraShown || settings.dayOffset !== 0) return;
    untrack(() => conditions.refreshAurora());
    const id = setInterval(() => conditions.refreshAurora(), 10 * 60_000);
    return () => clearInterval(id);
  });

  const NAV = $derived([
    { href: '/', label: 'Map' },
    ...(alerts.status ? [{ href: '/alerts', label: 'Alerts' }] : []),
    { href: '/settings', label: 'Settings' },
    { href: '/about', label: 'About' },
  ]);
  const onMap = $derived(page.url.pathname === '/');
</script>

<div class="shell" class:on-map={onMap}>
  <header class="top">
    <a href="/" class="brand" aria-label="Atmos home">
      <img class="logo" src="/favicon.svg" alt="" width="30" height="30" />
      <span class="name">Atmos</span>
      <span class="tagline">Find the conditions. Capture the moment.</span>
    </a>
    <nav aria-label="Main">
      {#each NAV as item (item.href)}
        <a href={item.href} aria-current={page.url.pathname === item.href ? 'page' : undefined}>
          {item.label}
        </a>
      {/each}
    </nav>
  </header>

  <!-- Opening a hill or zone sheet keeps the page where it is. -->
  <main data-sveltekit-reset="false">
    {@render children()}
  </main>

  {#if !onMap}
  <footer class="small muted">
    A guide, not a safety service. Always check the
    <a href="https://www.metoffice.gov.uk/weather/specialist-forecasts/mountain" target="_blank" rel="noopener">Met Office mountain forecast</a>
    and <a href="https://www.mwis.org.uk/" target="_blank" rel="noopener">MWIS</a> before going onto the hills.
    <a href="/about">Data sources</a>.
  </footer>
  {/if}
</div>


<style>
  .shell {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
  }
  .shell.on-map {
    height: 100dvh;
    overflow: hidden;
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    height: 57px;
    padding: 0 20px;
    border-bottom: 1px solid var(--line);
    background: var(--paper);
  }
  .brand {
    text-decoration: none;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .logo {
    flex: none;
    border-radius: 7px;
  }
  .name {
    font-size: 1.6rem;
    font-weight: 850;
    font-stretch: 62%;
    letter-spacing: 0.01em;
  }
  .tagline {
    color: var(--ink-soft);
    font-size: 0.9rem;
  }
  nav {
    display: flex;
    gap: 4px;
  }
  nav a {
    text-decoration: none;
    padding: 6px 10px;
    border-radius: 6px;
    color: var(--ink-soft);
  }
  nav a[aria-current='page'] {
    color: var(--ink);
    background: var(--surface);
    font-weight: 650;
  }
  main {
    flex: 1;
    width: 100%;
  }
  footer {
    padding: 16px 20px 24px;
    border-top: 1px solid var(--line);
  }

  /* Phones: the tagline goes; the header stays one compact row. */
  @media (max-width: 640px) {
    .tagline {
      display: none;
    }
    .top {
      padding: 10px 12px;
    }
    nav a {
      padding: 6px 8px;
    }
  }
</style>
