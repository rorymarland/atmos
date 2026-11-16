<script lang="ts">
  /**
   * Search box for the map: hills from Atmos's own list as you type, plus UK places and
   * postcodes from free geocoders.
   */
  import { conditions } from '#lib/conditions.svelte.ts';
  import { suggestPlaces } from '#lib/geocode.ts';
  import type { StartPoint } from '#lib/settings.svelte.ts';

  let {
    onHill,
    onPlace,
  }: {
    onHill: (hill: { number: number; lat: number; lon: number }) => void;
    onPlace: (place: StartPoint) => void;
  } = $props();

  type Suggestion =
    | { kind: 'hill'; key: string; label: string; detail: string; number: number; lat: number; lon: number }
    | { kind: 'place'; key: string; label: string; detail: string; place: StartPoint };

  let query = $state('');
  let places = $state<StartPoint[]>([]);
  let searching = $state(false);
  let open = $state(false);
  let active = $state(0);
  let input: HTMLInputElement | undefined = $state();

  const hills = $derived.by((): Suggestion[] => {
    const q = query.trim().toLowerCase();
    const data = conditions.data;
    if (q.length < 2 || !data) return [];
    const starts: Suggestion[] = [];
    const contains: Suggestion[] = [];
    for (const h of data.hills) {
      if (h.zone < 0) continue;
      const name = h.name.toLowerCase();
      const i = name.indexOf(q);
      if (i < 0) continue;
      const s: Suggestion = {
        kind: 'hill',
        key: `h${h.number}`,
        label: h.name,
        detail: `${Math.round(h.metres)} m, ${data.zones[h.zone]?.name ?? ''}`,
        number: h.number,
        lat: h.lat,
        lon: h.lon,
      };
      (i === 0 ? starts : contains).push(s);
      if (starts.length >= 5) break;
    }
    return [...starts, ...contains].slice(0, 5);
  });

  const suggestions = $derived<Suggestion[]>([
    ...hills,
    ...places.map((p, i) => ({ kind: 'place' as const, key: `p${i}${p.label}`, label: p.label, detail: 'Place', place: p })),
  ]);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  function onInput() {
    open = true;
    active = 0;
    clearTimeout(timer);
    controller?.abort();
    const q = query.trim();
    if (q.length < 2) {
      places = [];
      searching = false;
      return;
    }
    timer = setTimeout(async () => {
      controller = new AbortController();
      searching = true;
      try {
        places = await suggestPlaces(q, controller.signal);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') places = [];
      } finally {
        searching = false;
      }
    }, 250);
  }

  function choose(s: Suggestion) {
    open = false;
    query = s.label;
    if (s.kind === 'hill') onHill({ number: s.number, lat: s.lat, lon: s.lon });
    else onPlace(s.place);
    input?.blur();
  }

  function onKey(e: KeyboardEvent) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) open = true;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      active = Math.min(active + 1, suggestions.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      active = Math.max(active - 1, 0);
    } else if (e.key === 'Enter') {
      const s = suggestions[active];
      if (s) {
        e.preventDefault();
        choose(s);
      }
    } else if (e.key === 'Escape') {
      if (open) open = false;
      else query = '';
    }
  }
</script>

<div class="search" role="search">
  <input
    bind:this={input}
    bind:value={query}
    oninput={onInput}
    onkeydown={onKey}
    onfocus={() => (open = query.trim().length >= 2)}
    onblur={() => setTimeout(() => (open = false), 150)}
    type="search"
    placeholder="Search hills, places or postcodes"
    aria-label="Search hills, places or postcodes"
    role="combobox"
    aria-expanded={open && suggestions.length > 0}
    aria-controls="search-results"
    aria-activedescendant={open && suggestions[active] ? `sr-${suggestions[active]!.key}` : undefined}
    autocomplete="off"
    spellcheck="false"
  />
  {#if open && query.trim().length >= 2}
    <ul id="search-results" role="listbox">
      {#each suggestions as s, i (s.key)}
        <li
          id="sr-{s.key}"
          role="option"
          aria-selected={i === active}
          class:active={i === active}
          onmousedown={(e) => {
            e.preventDefault();
            choose(s);
          }}
          onmouseenter={() => (active = i)}
        >
          <span class="kind {s.kind}" aria-hidden="true"></span>
          <span class="text"><span>{s.label}</span><span class="small muted">{s.kind === 'hill' ? s.detail : 'Place'}</span></span>
        </li>
      {/each}
      {#if searching}
        <li class="note small muted" role="presentation">Searching places…</li>
      {:else if suggestions.length === 0}
        <li class="note small muted" role="presentation">Nothing found. Try a town, a postcode or a hill name.</li>
      {/if}
    </ul>
  {/if}
</div>

<style>
  .search {
    position: relative;
    width: min(320px, calc(100vw - 24px));
  }
  input {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--paper);
    color: var(--ink);
    box-shadow: 0 4px 16px rgb(20 29 36 / 0.14);
    font: inherit;
  }
  input:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 1px;
  }
  ul {
    position: absolute;
    z-index: 5;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    margin: 0;
    padding: 4px;
    list-style: none;
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 10px;
    box-shadow: 0 8px 24px rgb(20 29 36 / 0.18);
    max-height: 60vh;
    overflow-y: auto;
  }
  li {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 6px 8px;
    border-radius: 6px;
    cursor: pointer;
  }
  li.active {
    background: var(--surface);
  }
  li.note {
    cursor: default;
  }
  .text {
    display: flex;
    flex-direction: column;
    line-height: 1.25;
  }
  .kind {
    flex: none;
    width: 0;
    height: 0;
    border-left: 6px solid transparent;
    border-right: 6px solid transparent;
    border-bottom: 10px solid var(--ink-soft);
  }
  .kind.place {
    width: 10px;
    height: 10px;
    border: 2px solid var(--ink-soft);
    border-radius: 50%;
  }
</style>
