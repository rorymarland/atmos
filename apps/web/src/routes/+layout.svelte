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

  // Shared forecasts: look for a newer copy every five minutes and when the tab is shown
  // again. A no-op when this browser fetches from Open-Meteo itself.
  $effect(() => {
    const id = setInterval(() => conditions.poll(), 5 * 60_000);
    const onShow = () => document.visibilityState === 'visible' && conditions.poll();
    document.addEventListener('visibilitychange', onShow);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onShow);
    };
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
    { href: '/places', label: 'Places' },
    ...(alerts.status ? [{ href: '/alerts', label: 'Alerts' }] : []),
    { href: '/settings', label: 'Settings' },
    { href: '/help', label: 'Help' },
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
    <div class="right">
      <nav aria-label="Main">
        {#each NAV as item (item.href)}
          <a href={item.href} aria-current={page.url.pathname === item.href ? 'page' : undefined}>
            {item.label}
          </a>
        {/each}
      </nav>
      <button
        class="theme"
        onclick={() => (settings.theme = settings.theme === 'dark' ? 'light' : 'dark')}
        aria-label={settings.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        title={settings.theme === 'dark' ? 'Light mode' : 'Dark mode'}
      >
        {#if settings.theme === 'dark'}
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="4.5" fill="currentColor" /><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" /></g></svg>
        {:else}
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" fill="currentColor" /></svg>
        {/if}
      </button>
    </div>
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
  .theme {
    display: inline-grid;
    place-items: center;
    width: 32px;
    height: 32px;
    margin-left: 4px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface);
    color: var(--ink);
    cursor: pointer;
  }
  .theme:hover {
    background: var(--paper);
  }
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
  .right {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }
  nav {
    display: flex;
    gap: 4px;
    min-width: 0;
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

  /* Phones: just the logo, a compact menu that scrolls sideways if it must, and the theme
     button always in reach. */
  @media (max-width: 640px) {
    .tagline,
    .name {
      display: none;
    }
    .top {
      height: 50px;
      gap: 8px;
      padding: 0 10px;
    }
    .logo {
      width: 28px;
      height: 28px;
    }
    nav {
      gap: 0;
      overflow-x: auto;
      scrollbar-width: none;
    }
    nav::-webkit-scrollbar {
      display: none;
    }
    nav a {
      padding: 6px 7px;
      font-size: 0.92rem;
      white-space: nowrap;
    }
    .theme {
      flex: none;
    }
  }
</style>
