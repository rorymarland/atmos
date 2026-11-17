<script lang="ts">
  /**
   * Create or change an alert: where, what, how good, when, how far ahead, and when to send.
   * Opened from the alerts page, or from a hill's panel with that hill and condition filled in.
   */
  import { conditions } from '#lib/conditions.svelte.ts';
  import { favourites } from '#lib/favourites.svelte.ts';
  import { CONDITION_GROUPS } from '#lib/groups.ts';
  import {
    alerts,
    placeRefOf,
    rememberEmail,
    rememberedEmail,
    type AlertInput,
    type AlertView,
    type PlaceRef,
  } from '#lib/alerts.svelte.ts';
  import { PERIOD_LABELS, type Period } from '#lib/sun.ts';
  import PlaceSearch from '#lib/components/PlaceSearch.svelte';

  let {
    open = $bindable(false),
    editing = null,
    preset = null,
    onSaved,
  }: {
    open?: boolean;
    /** The alert being changed, or null for a new one. */
    editing?: AlertView | null;
    /** For a new alert: what to start with. */
    preset?: Partial<AlertInput> | null;
    onSaved?: (a: AlertView) => void;
  } = $props();

  const PERIODS: Period[] = ['morning', 'day', 'evening', 'night'];
  const DAYS = [
    [1, 'Today only'],
    [2, 'Today and tomorrow'],
    [3, 'The next 3 days'],
    [4, 'The next 4 days'],
    [5, 'The next 5 days'],
  ] as const;

  let form = $state<AlertInput>(blank());
  let deliveryMode = $state<'asap' | 'daily'>('asap');
  let deliveryAt = $state('07:00');
  let saving = $state(false);
  let error = $state<string | null>(null);

  function blank(): AlertInput {
    return {
      email: rememberedEmail(),
      label: '',
      places: [],
      conditions: [],
      match: 'any',
      minVerdict: 'go',
      periods: ['morning', 'evening'],
      daysAhead: 2,
      delivery: { mode: 'asap' },
      paused: false,
    };
  }

  let dialog = $state<HTMLDialogElement>();
  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      const start: AlertInput = editing
        ? {
            email: editing.email,
            label: editing.label ?? '',
            places: [...editing.places],
            conditions: [...editing.conditions],
            match: editing.match,
            minVerdict: editing.minVerdict,
            periods: [...editing.periods],
            daysAhead: editing.daysAhead,
            delivery: editing.delivery,
            paused: editing.paused,
          }
        : { ...blank(), ...preset };
      form = start;
      deliveryMode = start.delivery.mode;
      deliveryAt = start.delivery.mode === 'daily' ? start.delivery.at : '07:00';
      error = null;
      dialog.showModal();
    } else if (!open && dialog.open) dialog.close();
  });

  const profiles = $derived(conditions.data?.config.profiles ?? {});
  const groups = $derived(
    CONDITION_GROUPS.map((g) => ({ ...g, ids: g.ids.filter((id) => profiles[id]) })).filter((g) => g.ids.length),
  );
  const keyOf = (p: PlaceRef) => (p.kind === 'hill' ? `h${p.number}` : `w${p.id}`);

  function addPlace(p: PlaceRef | null) {
    if (!p || form.places.some((x) => keyOf(x) === keyOf(p))) return;
    form.places = [...form.places, p];
  }
  const favRefs = $derived(
    favourites.list
      .map((f) => placeRefOf(f.hill, conditions.data))
      .filter((p): p is PlaceRef => p !== null && !form.places.some((x) => keyOf(x) === keyOf(p))),
  );

  function toggle<T>(list: T[], item: T): T[] {
    return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
  }

  const problems = $derived.by(() => {
    const p: string[] = [];
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) p.push('an email address');
    if (form.places.length === 0) p.push('at least one place');
    if (form.conditions.length === 0) p.push('at least one condition');
    if (form.periods.length === 0) p.push('a time of day');
    return p;
  });

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (problems.length) return;
    saving = true;
    error = null;
    const input: AlertInput = {
      ...form,
      email: form.email.trim(),
      label: form.label?.trim() || undefined,
      delivery: deliveryMode === 'daily' ? { mode: 'daily', at: deliveryAt } : { mode: 'asap' },
    };
    try {
      const saved = editing ? await alerts.update(editing.id, input) : await alerts.create(input);
      rememberEmail(input.email);
      open = false;
      onSaved?.(saved);
    } catch (err) {
      error = (err as Error).message;
    } finally {
      saving = false;
    }
  }
</script>

<dialog bind:this={dialog} class="editor" aria-labelledby="alert-title" onclose={() => (open = false)}>
  <form onsubmit={save}>
    <header>
      <h2 id="alert-title">{editing ? 'Change alert' : 'New alert'}</h2>
      <button type="button" class="close" onclick={() => (open = false)}>Close</button>
    </header>

    <label class="field">
      <span>Send to</span>
      <input type="email" bind:value={form.email} placeholder="you@example.com" autocomplete="email" required />
    </label>
    <label class="field">
      <span>Name <span class="muted">(optional)</span></span>
      <input bind:value={form.label} maxlength="80" placeholder="e.g. Trossachs mornings" />
    </label>

    <fieldset>
      <legend>Where</legend>
      {#if form.places.length}
        <ul class="chips">
          {#each form.places as p (keyOf(p))}
            <li>
              {p.name}
              <button type="button" aria-label="Remove {p.name}" onclick={() => (form.places = form.places.filter((x) => x !== p))}>×</button>
            </li>
          {/each}
        </ul>
      {/if}
      <PlaceSearch
        hillsOnly
        placeholder="Add a hill or loch"
        onHill={(h) => addPlace(placeRefOf(h.hill, conditions.data))}
      />
      {#if favRefs.length}
        <p class="small muted favs">
          Favourites:
          {#each favRefs as p (keyOf(p))}<button type="button" class="link" onclick={() => addPlace(p)}>{p.name}</button>{/each}
        </p>
      {/if}
    </fieldset>

    <fieldset>
      <legend>What</legend>
      <div class="groups">
        {#each groups as g (g.label)}
          <div>
            <span class="small muted">{g.label}</span>
            {#each g.ids as id (id)}
              <label class="tick">
                <input type="checkbox" checked={form.conditions.includes(id)} onchange={() => (form.conditions = toggle(form.conditions, id))} />
                {profiles[id]?.label}
              </label>
            {/each}
          </div>
        {/each}
      </div>
      {#if form.conditions.length > 1}
        <div class="radios">
          <label><input type="radio" bind:group={form.match} value="any" /> Any of these</label>
          <label><input type="radio" bind:group={form.match} value="all" /> All of them on the same day</label>
        </div>
      {/if}
    </fieldset>

    <fieldset>
      <legend>How good</legend>
      <div class="radios">
        <label><input type="radio" bind:group={form.minVerdict} value="go" /> Go only</label>
        <label><input type="radio" bind:group={form.minVerdict} value="maybe" /> Maybe or better</label>
      </div>
    </fieldset>

    <fieldset>
      <legend>When</legend>
      <div class="radios">
        {#each PERIODS as p (p)}
          <label class="tick">
            <input type="checkbox" checked={form.periods.includes(p)} onchange={() => (form.periods = toggle(form.periods, p))} />
            {PERIOD_LABELS[p]}
          </label>
        {/each}
      </div>
      <label class="field inline">
        <span>Looking at</span>
        <select bind:value={form.daysAhead}>
          {#each DAYS as [n, label] (n)}<option value={n}>{label}</option>{/each}
        </select>
      </label>
    </fieldset>

    <fieldset>
      <legend>Send</legend>
      <div class="radios stack">
        <label>
          <input type="radio" bind:group={deliveryMode} value="asap" />
          As soon as it’s spotted <span class="small muted">(checked hourly; nothing between 22:00 and 06:00)</span>
        </label>
        <label>
          <input type="radio" bind:group={deliveryMode} value="daily" />
          Once a day at
          <input type="time" bind:value={deliveryAt} disabled={deliveryMode !== 'daily'} step="900" />
          <span class="small muted">with everything that matches</span>
        </label>
      </div>
    </fieldset>

    {#if error}<p class="small error" role="alert">{error}</p>{/if}
    <footer>
      {#if problems.length}<span class="small muted">Still needs {problems.join(', ')}.</span>{/if}
      <button class="button" disabled={saving || problems.length > 0}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create alert'}</button>
    </footer>
  </form>
</dialog>

<style>
  .editor {
    width: min(560px, calc(100vw - 24px));
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
  footer {
    justify-content: flex-end;
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
  .field {
    display: grid;
    gap: 4px;
  }
  .field.inline {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .field input,
  .field select,
  input[type='time'] {
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 6px 8px;
    background: var(--paper);
    color: var(--ink);
    font: inherit;
  }
  .groups {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 10px 16px;
  }
  .groups > div {
    display: grid;
    gap: 3px;
    align-content: start;
  }
  .tick,
  .radios label {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .radios {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 18px;
  }
  .radios.stack {
    display: grid;
  }
  .chips {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chips li {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: 1px solid var(--line);
    background: var(--paper);
    border-radius: 999px;
    padding: 2px 4px 2px 10px;
  }
  .chips button {
    border: 0;
    background: none;
    font-size: 1rem;
    line-height: 1;
    padding: 2px 6px;
    cursor: pointer;
    color: var(--ink-soft);
  }
  .favs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
    margin: 0;
  }
  .link {
    border: 0;
    background: none;
    padding: 0;
    text-decoration: underline;
    text-underline-offset: 0.18em;
    color: inherit;
    cursor: pointer;
  }
  .error {
    color: var(--no);
    margin: 0;
  }
  .muted {
    color: var(--ink-soft);
  }
</style>
