<script lang="ts">
  /**
   * Custom places: spots anyone using this Atmos has added, scored like hills. Add one here
   * by grid reference or latitude and longitude, or from the map with Save this spot.
   */
  import { onMount } from 'svelte';
  import { PLACE_KINDS, type CustomPlace } from '@atmos/engine';
  import { conditions } from '#lib/conditions.svelte.ts';
  import { places } from '#lib/places.svelte.ts';
  import PlaceEditor from '#lib/components/PlaceEditor.svelte';
  import VerdictMark from '#lib/components/VerdictMark.svelte';

  let editorOpen = $state(false);
  let editing = $state<CustomPlace | null>(null);
  let notice = $state<string | null>(null);

  onMount(() => {
    if (places.source === null) void places.load();
  });

  const verdictOf = (n: number) => conditions.ranking.hillsByNumber.get(n)?.verdict;

  function add() {
    editing = null;
    editorOpen = true;
  }
  function change(p: CustomPlace) {
    editing = p;
    editorOpen = true;
  }
</script>

<svelte:head><title>Places · Atmos</title></svelte:head>

<div class="page">
  <header class="top">
    <h1>Your places</h1>
    <button class="button" onclick={add}>Add a place</button>
  </header>

  <p class="intro">
    Spots of your own (a crag, a viewpoint, a bit of lochside), scored for every condition just like the hills, each
    with its own forecast. They compete in the results and best bet, and <strong>My places</strong> under the hill
    lists shows them on their own. To add one from the map, click where it is and choose <strong>Save this spot</strong>.
  </p>
  {#if places.source === 'server'}
    <p class="small muted">Shared by everyone using this Atmos, on every device.</p>
  {:else if places.source === 'browser'}
    <p class="small warn">
      The Atmos server container isn’t running, so places are kept in this browser only. Run it (see the README) to
      share them.
    </p>
  {/if}

  {#if notice}<p class="notice" role="status">{notice}</p>{/if}

  {#if places.list.length === 0}
    <section><p class="muted">No places yet.</p></section>
  {:else}
    <ul class="places">
      {#each places.list as p (p.id)}
        {@const v = verdictOf(p.number)}
        <li>
          <div class="what">
            <a href="/?hill={p.number}" data-sveltekit-reset="false"><strong>{p.name}</strong></a>
            <span class="small muted">
              {PLACE_KINDS[p.kind].label}, {Math.round(p.metres)} m. {p.lat.toFixed(5)}, {p.lon.toFixed(5)}.
            </span>
          </div>
          {#if v}<VerdictMark verdict={v} />{/if}
          <button class="button quiet" onclick={() => change(p)}>Change</button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<PlaceEditor
  bind:open={editorOpen}
  {editing}
  onSaved={(p) => (notice = p ? `Saved ${p.name}.` : 'Saved.')}
  onDeleted={() => (notice = 'Place deleted.')}
/>

<style>
  .page {
    max-width: 760px;
    margin: 0 auto;
    padding: 24px 20px 40px;
    display: grid;
    gap: 16px;
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  h1 {
    margin: 0;
  }
  p {
    margin: 0;
  }
  section {
    padding-top: 14px;
    border-top: 1px solid var(--line);
  }
  .places {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  .places li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 12px;
    align-items: center;
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 10px 12px;
    background: var(--paper);
  }
  .what {
    display: grid;
    gap: 2px;
  }
  .notice {
    padding: 8px 12px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--go) 12%, var(--paper));
  }
  .warn {
    color: var(--no);
  }
  .muted {
    color: var(--ink-soft);
  }
</style>
