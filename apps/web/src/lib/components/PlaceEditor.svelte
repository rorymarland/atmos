<script lang="ts">
  /**
   * Add or change a custom place: a name, a type, where it is (the map pin, a grid
   * reference or latitude and longitude) and its height, looked up from terrain data.
   */
  import { parseLocation, PLACE_KINDS, type CustomPlace, type PlaceKind } from '@atmos/engine';
  import { places, type PlaceInput } from '#lib/places.svelte.ts';
  import { heightAt } from '#lib/routes.ts';

  let {
    open = $bindable(false),
    editing = null,
    preset = null,
    onSaved,
    onDeleted,
  }: {
    open?: boolean;
    /** The place being changed, or null for a new one. */
    editing?: CustomPlace | null;
    /** For a new place: where (from the map pin) and a suggested name. */
    preset?: { lat: number; lon: number; name?: string } | null;
    onSaved?: (p: CustomPlace | null) => void;
    onDeleted?: () => void;
  } = $props();

  const KINDS = Object.entries(PLACE_KINDS) as [PlaceKind, { label: string; hint: string }][];

  let name = $state('');
  let kind = $state<PlaceKind>('viewpoint');
  let where = $state('');
  let at = $state<{ lat: number; lon: number } | null>(null);
  let metres = $state<number | null>(null);
  let metresTouched = $state(false);
  let lookingUp = $state(false);
  let saving = $state(false);
  let error = $state<string | null>(null);

  let dialog = $state<HTMLDialogElement>();
  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      error = null;
      metresTouched = !!editing;
      if (editing) {
        name = editing.name;
        kind = editing.kind;
        at = { lat: editing.lat, lon: editing.lon };
        metres = editing.metres;
      } else {
        name = preset?.name && preset.name !== 'the pin' ? preset.name : '';
        kind = 'viewpoint';
        at = preset ? { lat: preset.lat, lon: preset.lon } : null;
        metres = null;
      }
      where = at ? `${at.lat.toFixed(5)}, ${at.lon.toFixed(5)}` : '';
      if (at && !editing) void lookUpHeight();
      dialog.showModal();
    } else if (!open && dialog.open) dialog.close();
  });

  /** Typed in the location box: a grid reference or latitude and longitude. */
  const typed = $derived(where.trim() ? parseLocation(where) : null);
  const whereProblem = $derived(where.trim() && !typed ? 'That isn’t a grid reference or a UK latitude and longitude.' : null);

  async function lookUpHeight() {
    if (!at) return;
    lookingUp = true;
    const h = await heightAt(at.lat, at.lon).catch(() => null);
    lookingUp = false;
    if (h !== null && !metresTouched) metres = h;
  }

  function useTyped() {
    if (!typed) return;
    at = { lat: typed.lat, lon: typed.lon };
    metresTouched = false;
    void lookUpHeight();
  }

  /** Atmos covers the UK only (its forecasts, lochs and hill data stop at the border). */
  const inUk = $derived(!at || (at.lat >= 49 && at.lat <= 61.5 && at.lon >= -11 && at.lon <= 2.5));
  const ready = $derived(
    name.trim().length > 0 && at !== null && inUk && metres !== null && Number.isFinite(metres),
  );

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!ready || !at || metres === null) return;
    saving = true;
    error = null;
    const input: PlaceInput = { name: name.trim(), kind, lat: at.lat, lon: at.lon, metres: Math.round(metres) };
    try {
      if (editing) {
        await places.update(editing.id, input);
        onSaved?.(null);
      } else {
        onSaved?.(await places.add(input));
      }
      open = false;
    } catch (err) {
      error = (err as Error).message;
    } finally {
      saving = false;
    }
  }

  async function remove() {
    if (!editing || !confirm(`Delete ${editing.name}? Alerts that watch it will stop finding it.`)) return;
    try {
      await places.remove(editing.id);
      open = false;
      onDeleted?.();
    } catch (err) {
      error = (err as Error).message;
    }
  }
</script>

<dialog bind:this={dialog} class="editor" aria-labelledby="place-title" onclose={() => (open = false)}>
  <form onsubmit={save}>
    <header>
      <h2 id="place-title">{editing ? 'Change place' : 'Save a place'}</h2>
      <button type="button" class="close" onclick={() => (open = false)}>Close</button>
    </header>

    <label class="field">
      <span>Name</span>
      <input bind:value={name} maxlength="80" placeholder="e.g. Kilchurn Castle viewpoint" required />
    </label>

    <fieldset>
      <legend>Type</legend>
      {#each KINDS as [id, k] (id)}
        <label class="kind">
          <input type="radio" bind:group={kind} value={id} />
          <span><strong>{k.label}</strong><span class="small muted">{k.hint}</span></span>
        </label>
      {/each}
    </fieldset>

    <fieldset>
      <legend>Where</legend>
      <div class="where">
        <input
          bind:value={where}
          placeholder="Grid reference (NN 166 712) or 56.796, -5.004"
          aria-label="Grid reference, or latitude and longitude"
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              useTyped();
            }
          }}
        />
        <button type="button" class="button quiet" onclick={useTyped} disabled={!typed}>Use this</button>
      </div>
      {#if whereProblem}<p class="small error">{whereProblem}</p>{/if}
      {#if at && !inUk}
        <p class="small error">That’s outside the UK, which is all Atmos covers.</p>
      {:else if at}
        <p class="small muted">
          At {at.lat.toFixed(5)}, {at.lon.toFixed(5)}{#if typed?.precisionM && typed.precisionM >= 100}{` (the middle of a ${typed.precisionM} m square)`}{/if}.
        </p>
      {:else}
        <p class="small muted">Or close this, click the map where it is, and choose <strong>Save this spot</strong>.</p>
      {/if}
      <label class="field inline">
        <span>Height</span>
        <input
          type="number"
          min="-10"
          max="1400"
          step="1"
          bind:value={metres}
          oninput={() => (metresTouched = true)}
          aria-describedby="height-note"
        />
        <span>m</span>
        <span id="height-note" class="small muted">{lookingUp ? 'Looking it up…' : 'From terrain data; change it if you know better.'}</span>
      </label>
    </fieldset>

    {#if places.source === 'browser'}
      <p class="small muted">The Atmos server container isn’t running, so this place is kept in this browser only.</p>
    {/if}
    {#if error}<p class="small error" role="alert">{error}</p>{/if}
    <footer>
      {#if editing}<button type="button" class="button quiet danger" onclick={remove}>Delete</button>{/if}
      <span class="spacer"></span>
      <button class="button" disabled={!ready || saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Save place'}</button>
    </footer>
  </form>
</dialog>

<style>
  .editor {
    width: min(500px, calc(100vw - 24px));
    max-height: calc(100dvh - 24px);
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--surface);
    color: var(--ink);
    padding: 16px 20px 18px;
    box-shadow: 0 18px 48px rgb(15 25 32 / 0.25);
  }
  .editor::backdrop {
    background: rgb(15 25 32 / 0.35);
  }
  form {
    display: grid;
    gap: 14px;
  }
  header,
  footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }
  .spacer {
    flex: 1;
  }
  h2 {
    margin: 0;
    font-size: 1.25rem;
  }
  .close {
    border: 1px solid var(--line);
    background: var(--surface);
    border-radius: 6px;
    padding: 3px 10px;
    font-size: 0.85rem;
  }
  fieldset {
    border: 0;
    border-top: 1px solid var(--line);
    margin: 0;
    padding: 10px 0 0;
    display: grid;
    gap: 8px;
  }
  legend {
    font-weight: 600;
    padding: 0;
    float: left;
    width: 100%;
    margin-bottom: 4px;
  }
  .kind {
    display: flex;
    gap: 8px;
    align-items: flex-start;
  }
  .kind > span {
    display: grid;
  }
  .field {
    display: grid;
    gap: 4px;
  }
  .field.inline {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .field.inline input {
    width: 6em;
  }
  .where {
    display: flex;
    gap: 6px;
  }
  .where input {
    flex: 1;
    min-width: 0;
  }
  input:not([type='radio']) {
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 6px 8px;
    background: var(--paper);
    color: var(--ink);
    font: inherit;
  }
  p {
    margin: 0;
  }
  .error,
  .danger {
    color: var(--no);
  }
  .muted {
    color: var(--ink-soft);
  }
</style>
