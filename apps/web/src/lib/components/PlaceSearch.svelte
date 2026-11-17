<script lang="ts">
  /**
   * Search box for the map: hills from Atmos's own list as you type, plus UK places and
   * postcodes from free geocoders. With nothing typed it lists your favourite hills, and
   * every hill row has a star to add or remove it.
   */
  import { favourites } from '#lib/favourites.svelte.ts';
  import Star from '#lib/components/Star.svelte';
  import VerdictMark from '#lib/components/VerdictMark.svelte';
  import { conditions } from '#lib/conditions.svelte.ts';
  import { suggestPlaces } from '#lib/geocode.ts';
  import { loadSearchHills } from '#lib/static-data.ts';
  import { waterAsPlace, type Hill } from '@atmos/engine';
  import type { StartPoint } from '#lib/settings.svelte.ts';

  let {
    onHill,
    onPlace,
    placeholder = 'Search hills, places or postcodes',
    keepQuery = false,
    hillsOnly = false,
  }: {
    /** Hills and lochs only: no towns or postcodes. */
    hillsOnly?: boolean;
    placeholder?: string;
    /** Leave the chosen name in the box (the map) or clear it for the next search. */
    keepQuery?: boolean;
    /** `other` is set for hills not on the lists (mostly Tumps), which aren't loaded yet. */
    onHill: (hill: { number: number; lat: number; lon: number; other?: Hill; hill: Hill }) => void;
    onPlace?: (place: StartPoint) => void;
  } = $props();

  type Suggestion =
    | {
        kind: 'hill';
        key: string;
        label: string;
        detail: string;
        number: number;
        lat: number;
        lon: number;
        hill: Hill;
        other?: Hill;
      }
    | { kind: 'place'; key: string; label: string; detail: string; place: StartPoint };

  /** Unique per search box: the map's and the alert editor's can be on screen together. */
  const uid = $props.id();
  let query = $state('');
  let places = $state<StartPoint[]>([]);
  let searching = $state(false);
  let open = $state(false);
  let active = $state(0);
  let input: HTMLInputElement | undefined = $state();
  /** Every other UK hill, fetched the first time the box is used. */
  let others = $state.raw<Hill[]>([]);
  function loadOthers() {
    if (others.length === 0) void loadSearchHills().then((h) => (others = h));
  }

  const hills = $derived.by((): Suggestion[] => {
    const q = query.trim().toLowerCase();
    const data = conditions.data;
    if (q.length < 2 || !data) return [];
    // Listed hills first, then the rest; names starting with the query before the others.
    const find = (list: Hill[], other: boolean, max: number): Suggestion[] => {
      const starts: Suggestion[] = [];
      const contains: Suggestion[] = [];
      for (const h of list) {
        if (h.zone < 0) continue;
        const i = h.name.toLowerCase().indexOf(q);
        if (i < 0) continue;
        const s: Suggestion = {
          kind: 'hill',
          key: `h${h.number}`,
          label: h.name,
          detail: `${Math.round(h.metres)} m, ${other ? 'not on your lists, ' : ''}${data.zones[h.zone]?.name ?? ''}`,
          number: h.number,
          lat: h.lat,
          lon: h.lon,
          hill: h,
          ...(other ? { other: h } : {}),
        };
        (i === 0 ? starts : contains).push(s);
        if (starts.length >= max) break;
      }
      return [...starts, ...contains].slice(0, max);
    };
    const listed = find(data.hills, false, 5);
    return [...listed, ...find(others, true, 7 - listed.length)];
  });

  /** Named lochs and lakes: up to three, names starting with the query first, then bigger. */
  const lochs = $derived.by((): Suggestion[] => {
    const q = query.trim().toLowerCase();
    const data = conditions.data;
    if (q.length < 2 || !data?.waters) return [];
    const hits: { i: number; starts: boolean; ha: number }[] = [];
    data.waters.forEach((w, i) => {
      if (!w.name || w.zone < 0) return;
      const at = w.name.toLowerCase().indexOf(q);
      if (at >= 0) hits.push({ i, starts: at === 0, ha: w.ha });
    });
    hits.sort((a, b) => Number(b.starts) - Number(a.starts) || b.ha - a.ha);
    return hits.slice(0, 3).map(({ i }) => {
      const w = data.waters![i]!;
      const place = waterAsPlace(w, i);
      return {
        kind: 'hill' as const,
        key: `w${i}`,
        label: w.name,
        detail: waterDetail(w.ha, w.spanKm, data.zones[w.zone]?.name),
        number: place.number,
        lat: w.lat,
        lon: w.lon,
        hill: place,
        other: place,
      };
    });
  });
  function waterDetail(ha: number, spanKm: number, zone?: string) {
    const size = spanKm >= 1 ? `${spanKm.toFixed(1)} km long` : `${Math.round(ha)} ha`;
    return `Loch or lake, ${size}${zone ? `, ${zone}` : ''}`;
  }

  const typing = $derived(query.trim().length >= 2);
  /** Favourites, in the order they were starred. */
  const favs = $derived.by((): Suggestion[] => {
    const data = conditions.data;
    return favourites.list.map(({ hill: h, other }) => ({
      kind: 'hill' as const,
      key: `f${h.number}`,
      label: h.name,
      detail:
        h.kind === 'water'
          ? `Loch or lake, ${data?.zones[h.zone]?.name ?? ''}`
          : `${Math.round(h.metres)} m, ${data?.zones[h.zone]?.name ?? ''}`,
      number: h.number,
      lat: h.lat,
      lon: h.lon,
      hill: h,
      ...(other ? { other: h } : {}),
    }));
  });
  const suggestions = $derived<Suggestion[]>(
    typing
      ? [
          ...hills,
          ...lochs,
          ...places.map((p, i) => ({ kind: 'place' as const, key: `p${i}${p.label}`, label: p.label, detail: 'Place', place: p })),
        ]
      : favs,
  );
  const verdictOf = (n: number) => conditions.ranking.hillsByNumber.get(n)?.verdict;

  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  function onInput() {
    loadOthers();
    open = true;
    active = 0;
    clearTimeout(timer);
    controller?.abort();
    const q = query.trim();
    if (q.length < 2 || hillsOnly) {
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
    query = keepQuery ? s.label : '';
    if (s.kind === 'hill')
      onHill({ number: s.number, lat: s.lat, lon: s.lon, hill: s.hill, ...(s.other ? { other: s.other } : {}) });
    else onPlace?.(s.place);
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
    onfocus={() => {
      loadOthers();
      open = true;
    }}
    onclick={() => (open = true)}
    onblur={() => setTimeout(() => (open = false), 150)}
    type="search"
    {placeholder}
    aria-label={placeholder}
    role="combobox"
    aria-expanded={open && suggestions.length > 0}
    aria-controls="{uid}-results"
    aria-activedescendant={open && suggestions[active] ? `${uid}-${suggestions[active]!.key}` : undefined}
    autocomplete="off"
    spellcheck="false"
  />
  {#if open}
    <ul id="{uid}-results" class="results" role="listbox" aria-label={typing ? 'Search results' : 'Favourite hills'}>
      {#if !typing && favs.length}
        <li class="heading small muted" role="presentation">Favourites</li>
      {/if}
      {#each suggestions as s, i (s.key)}
        <li
          id="{uid}-{s.key}"
          role="option"
          aria-selected={i === active}
          class:active={i === active}
          onmousedown={(e) => {
            e.preventDefault();
            choose(s);
          }}
          onmouseenter={() => (active = i)}
        >
          <span class="kind {s.kind}" class:water={s.kind === 'hill' && s.hill.kind === 'water'} aria-hidden="true"></span>
          <span class="text"><span>{s.label}</span><span class="small muted">{s.kind === 'hill' ? s.detail : 'Place'}</span></span>
          {#if s.kind === 'hill'}
            {@const v = verdictOf(s.number)}
            {#if !typing && v}<VerdictMark verdict={v} />{/if}
            <Star
              on={favourites.has(s.number)}
              name={s.label}
              onToggle={() => favourites.toggle(s.hill, !!s.other)}
            />
          {/if}
        </li>
      {/each}
      {#if !typing}
        {#if favs.length === 0}
          <li class="note small muted" role="presentation">
            Star a hill to keep it here: use the star next to its name in the panel or in these results.
          </li>
        {:else}
          <li class="note small muted" role="presentation">Type to search hills, places or postcodes.</li>
        {/if}
      {:else if searching}
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
  li.note,
  li.heading {
    cursor: default;
  }
  li.heading {
    padding: 4px 8px 2px;
  }
  .text {
    flex: 1;
    min-width: 0;
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
  .kind.water {
    width: 12px;
    height: 8px;
    border: 0;
    border-radius: 50%;
    background: var(--water, #3b82c4);
  }
  .kind.place {
    width: 10px;
    height: 10px;
    border: 2px solid var(--ink-soft);
    border-radius: 50%;
  }
</style>
