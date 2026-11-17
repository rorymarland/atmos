<script lang="ts">
  /**
   * The filter quiz: a few plain questions that fill in the search. Answers start from the
   * current settings, so running it twice changes only what you change. Nothing is
   * applied until the last step.
   */
  import { NATION_LABELS, type Nation } from '@atmos/engine';
  import { conditions } from '#lib/conditions.svelte.ts';
  import { findPlace } from '#lib/geocode.ts';
  import { CONDITION_GROUPS } from '#lib/groups.ts';
  import { settings, type StartPoint } from '#lib/settings.svelte.ts';
  import type { Moment, Period } from '#lib/sun.ts';
  import { dayLabel } from '#lib/time.ts';

  let { open = $bindable(false), onDone }: { open?: boolean; onDone?: () => void } = $props();

  let dialog = $state<HTMLDialogElement>();
  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      begin();
      dialog.showModal();
    } else if (!open && dialog.open) dialog.close();
  });

  type When = { id: string; label: string; hint: string; periods: Period[]; moment?: Moment };
  const WHENS: When[] = [
    { id: 'sunrise', label: 'Sunrise', hint: 'In place as the sun comes up', periods: ['morning'], moment: 'sunrise' },
    { id: 'am-golden', label: 'Morning golden hour', hint: 'Low warm light just after sunrise', periods: ['morning'], moment: 'golden' },
    { id: 'am-blue', label: 'Dawn blue hour', hint: 'The cool light before sunrise', periods: ['morning'], moment: 'blue' },
    { id: 'day', label: 'During the day', hint: 'Any time in daylight', periods: ['day'] },
    { id: 'pm-golden', label: 'Evening golden hour', hint: 'Low warm light before sunset', periods: ['evening'], moment: 'golden' },
    { id: 'sunset', label: 'Sunset', hint: 'In place as the sun goes down', periods: ['evening'], moment: 'sunset' },
    { id: 'pm-blue', label: 'Dusk blue hour', hint: 'The cool light after sunset', periods: ['evening'], moment: 'blue' },
    { id: 'night', label: 'At night', hint: 'Stars and aurora', periods: ['night'] },
    { id: 'any', label: 'Any time', hint: 'Whenever it’s best', periods: ['morning', 'day', 'evening', 'night'] },
  ];
  const NATIONS = Object.keys(NATION_LABELS) as Nation[];
  const MILES = [20, 30, 50, 75, 100, 150];
  const UP = ['03:00', '04:00', '05:00', '06:00', '07:00'];

  // Answers.
  let countries = $state<Nation[]>([]);
  let day = $state(1);
  let when = $state('any');
  let groups = $state<string[]>([]);
  let miles = $state<number | null>(null);
  let start = $state<StartPoint | null>(null);
  let up = $state<string | null>(null);

  let step = $state(0);
  const chosenWhen = $derived(WHENS.find((w) => w.id === when) ?? WHENS[WHENS.length - 1]!);
  const morning = $derived(chosenWhen.periods.includes('morning'));
  /** The questions in order; the get-up question only matters for a morning trip. */
  const steps = $derived(['where', 'day', 'when', 'what', 'far', ...(morning ? ['up'] : [])]);
  const current = $derived(steps[Math.min(step, steps.length - 1)]!);
  const last = $derived(step >= steps.length - 1);

  function begin() {
    step = 0;
    countries = [...settings.countries];
    day = settings.dayOffset;
    const p = settings.periods;
    when =
      p.length === 1
        ? (WHENS.find((w) => w.periods[0] === p[0] && (w.moment === undefined || w.moment === settings.moment))?.id ?? 'any')
        : 'any';
    groups = settings.conditions
      ? CONDITION_GROUPS.filter((g) => g.ids.some((id) => settings.conditions!.includes(id))).map((g) => g.label)
      : [];
    miles = settings.maxDriveMiles;
    start = settings.start ?? settings.home;
    up = settings.earliestUp;
    placeQuery = '';
    placeError = null;
  }

  function toggleCountry(n: Nation) {
    countries = countries.includes(n) ? countries.filter((x) => x !== n) : [...countries, n];
    if (countries.length === NATIONS.length) countries = [];
  }
  function toggleGroup(label: string) {
    groups = groups.includes(label) ? groups.filter((x) => x !== label) : [...groups, label];
  }

  /** Single-choice answers move straight on. */
  function pick(set: () => void) {
    set();
    if (!last) step += 1;
  }

  // Where from, for the distance question.
  let placeQuery = $state('');
  let placeError = $state<string | null>(null);
  let placeBusy = $state(false);
  async function lookUp(e: SubmitEvent) {
    e.preventDefault();
    placeError = null;
    placeBusy = true;
    try {
      const found = await findPlace(placeQuery);
      if (found[0]) start = found[0];
      else placeError = 'No UK place or postcode by that name.';
    } catch {
      placeError = 'Couldn’t look that up just now.';
    } finally {
      placeBusy = false;
    }
  }
  function useLocation() {
    placeError = null;
    navigator.geolocation?.getCurrentPosition(
      (pos) => {
        start = {
          lat: Math.round(pos.coords.latitude * 1e4) / 1e4,
          lon: Math.round(pos.coords.longitude * 1e4) / 1e4,
          label: 'your location',
        };
      },
      () => (placeError = 'Couldn’t get your location. Type a place or postcode instead.'),
      { timeout: 10_000 },
    );
  }

  function finish() {
    const profiles = conditions.data?.config.profiles ?? {};
    const ids = CONDITION_GROUPS.filter((g) => groups.includes(g.label))
      .flatMap((g) => g.ids)
      .filter((id) => profiles[id]);
    Object.assign(settings, {
      countries: [...countries],
      dayOffset: day,
      periods: [...chosenWhen.periods],
      moment: chosenWhen.moment ?? settings.moment,
      conditions: ids.length ? ids : null,
      maxDriveMiles: start ? miles : null,
      earliestUp: start && morning ? up : null,
      start,
      sort: 'best',
    });
    open = false;
    onDone?.();
  }

  const nightOnly = $derived(when === 'night');
</script>

<dialog bind:this={dialog} class="quiz" aria-labelledby="quiz-q" onclose={() => (open = false)}>
  <form method="dialog" class="top">
    <span class="small muted">Question {step + 1} of {steps.length}</span>
    <button class="close" aria-label="Close the quiz">Close</button>
  </form>
  <div class="progress" aria-hidden="true">
    {#each steps as s, i (s)}<i class:done={i <= step}></i>{/each}
  </div>

  {#if current === 'where'}
    <h2 id="quiz-q">Where do you want to go?</h2>
    <p class="small muted">Pick one or more.</p>
    <div class="options">
      <button class="option" aria-pressed={countries.length === 0} onclick={() => (countries = [])}>
        <strong>Anywhere in the UK</strong>
      </button>
      {#each NATIONS as n (n)}
        <button class="option" aria-pressed={countries.includes(n)} onclick={() => toggleCountry(n)}>
          <strong>{NATION_LABELS[n]}</strong>
        </button>
      {/each}
    </div>
  {:else if current === 'day'}
    <h2 id="quiz-q">Which day?</h2>
    <div class="options">
      {#each [0, 1, 2, 3, 4] as d (d)}
        <button class="option" aria-pressed={day === d} onclick={() => pick(() => (day = d))}>
          <strong>{dayLabel(d)}</strong>
          {#if d >= 3}<span class="small muted">Forecasts this far out are less sure</span>{/if}
        </button>
      {/each}
    </div>
  {:else if current === 'when'}
    <h2 id="quiz-q">When do you want to be in place?</h2>
    <div class="options">
      {#each WHENS as w (w.id)}
        <button class="option" aria-pressed={when === w.id} onclick={() => pick(() => (when = w.id))}>
          <strong>{w.label}</strong>
          <span class="small muted">{w.hint}</span>
        </button>
      {/each}
    </div>
  {:else if current === 'what'}
    <h2 id="quiz-q">What do you want to photograph?</h2>
    <p class="small muted">Pick any. None picked means everything.</p>
    <div class="options">
      {#each CONDITION_GROUPS as g (g.label)}
        <button class="option" aria-pressed={groups.includes(g.label)} onclick={() => toggleGroup(g.label)}>
          <strong>{g.label}</strong>
          <span class="small muted">{g.hint}</span>
        </button>
      {/each}
    </div>
    {#if nightOnly && groups.length && !groups.includes('Night')}
      <p class="small warn">You picked night: most of these need daylight, so add Night or go back and change the time.</p>
    {/if}
  {:else if current === 'far'}
    <h2 id="quiz-q">How far will you drive?</h2>
    <div class="from small">
      {#if start}
        <span>Starting from <strong>{start.label}</strong></span>
        <button class="link" onclick={() => (start = null)}>Change</button>
      {:else}
        <form class="place" onsubmit={lookUp}>
          <label for="quiz-place">Starting from</label>
          <input id="quiz-place" bind:value={placeQuery} placeholder="Postcode or town" autocomplete="postal-code" />
          <button class="button quiet" disabled={!placeQuery.trim() || placeBusy}>{placeBusy ? 'Finding…' : 'Find'}</button>
        </form>
        <button class="link" type="button" onclick={useLocation}>Use my location</button>
        {#if settings.home}<button class="link" type="button" onclick={() => (start = settings.home)}>Use home</button>{/if}
        {#if placeError}<p class="small error">{placeError}</p>{/if}
      {/if}
    </div>
    <div class="options grid">
      {#each MILES as m (m)}
        <button class="option" aria-pressed={miles === m} disabled={!start} onclick={() => pick(() => (miles = m))}>
          <strong>{m} miles</strong>
        </button>
      {/each}
      <button class="option" aria-pressed={miles === null} onclick={() => pick(() => (miles = null))}>
        <strong>Any distance</strong>
      </button>
    </div>
    {#if !start}<p class="small muted">Without a start point there are no leave times or drive limits.</p>{/if}
  {:else if current === 'up'}
    <h2 id="quiz-q">How early will you get up?</h2>
    <p class="small muted">Hills that need an earlier start drop down the list.</p>
    <div class="options grid">
      {#each UP as t (t)}
        <button class="option" aria-pressed={up === t} disabled={!start} onclick={() => (up = t)}>
          <strong>Not before {t}</strong>
        </button>
      {/each}
      <button class="option" aria-pressed={up === null} onclick={() => (up = null)}>
        <strong>Any time</strong>
      </button>
    </div>
    {#if !start}<p class="small muted">Needs a start point: go back a step to set one.</p>{/if}
  {/if}

  <div class="nav">
    <button class="button quiet" onclick={() => (step -= 1)} disabled={step === 0}>Back</button>
    {#if last}
      <button class="button" onclick={finish}>Show me where to go</button>
    {:else}
      <button class="button" onclick={() => (step += 1)}>Next</button>
    {/if}
  </div>
</dialog>

<style>
  .quiz {
    width: min(440px, calc(100vw - 24px));
    max-height: calc(100dvh - 24px);
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--surface);
    color: var(--ink);
    padding: 14px 18px 18px;
    box-shadow: 0 18px 48px rgb(15 25 32 / 0.25);
  }
  .quiz::backdrop {
    background: rgb(15 25 32 / 0.35);
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .close {
    border: 1px solid var(--line);
    background: var(--surface);
    border-radius: 6px;
    padding: 3px 10px;
    font-size: 0.85rem;
  }
  .progress {
    display: flex;
    gap: 4px;
    margin: 10px 0 14px;
  }
  .progress i {
    flex: 1;
    height: 4px;
    border-radius: 2px;
    background: var(--line);
  }
  .progress i.done {
    background: var(--go);
  }
  h2 {
    font-size: 1.2rem;
    margin: 0 0 4px;
  }
  h2 + p {
    margin: 0 0 4px;
  }
  .options {
    display: grid;
    gap: 6px;
    margin-top: 10px;
  }
  .options.grid {
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  }
  .option {
    display: grid;
    gap: 2px;
    text-align: left;
    border: 1px solid var(--line);
    background: var(--paper);
    border-radius: 8px;
    padding: 9px 12px;
  }
  .option strong {
    font-weight: 600;
  }
  .option[aria-pressed='true'] {
    border-color: var(--go);
    box-shadow: inset 0 0 0 1px var(--go);
    background: color-mix(in srgb, var(--go) 10%, var(--paper));
  }
  .option:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .from {
    margin: 8px 0 2px;
    display: flex;
    flex-wrap: wrap;
    gap: 6px 12px;
    align-items: center;
  }
  .place {
    display: flex;
    gap: 6px;
    align-items: center;
    flex-wrap: wrap;
    width: 100%;
  }
  .place input {
    flex: 1;
    min-width: 0;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 6px 8px;
    background: var(--paper);
  }
  .link {
    border: 0;
    background: none;
    padding: 0;
    text-decoration: underline;
    text-underline-offset: 0.18em;
  }
  .warn {
    color: var(--maybe);
  }
  .error {
    color: var(--no);
    width: 100%;
    margin: 0;
  }
  .nav {
    display: flex;
    justify-content: space-between;
    margin-top: 16px;
  }
  .nav .button:disabled {
    opacity: 0.4;
  }
</style>
