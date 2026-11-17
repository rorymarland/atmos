<script lang="ts">
  /**
   * Everyone's alerts on one page. Atmos is only reachable on the LAN and VPN, so there are
   * no accounts: each alert just names the email address it goes to.
   */
  import { onMount } from 'svelte';
  import { alerts, rememberedEmail, type AlertView } from '#lib/alerts.svelte.ts';
  import { conditions } from '#lib/conditions.svelte.ts';
  import { PERIOD_LABELS } from '#lib/sun.ts';
  import AlertEditor from '#lib/components/AlertEditor.svelte';

  let list = $state<AlertView[]>([]);
  let loadError = $state<string | null>(null);
  let filter = $state(rememberedEmail());
  let editorOpen = $state(false);
  let editing = $state<AlertView | null>(null);
  let notice = $state<string | null>(null);
  let busy = $state<string | null>(null);

  async function load() {
    try {
      list = await alerts.list();
      loadError = null;
    } catch (e) {
      loadError = (e as Error).message;
    }
  }
  onMount(async () => {
    if ((await alerts.probe()) !== false) await load();
  });

  const shown = $derived(
    filter.trim() ? list.filter((a) => a.email.toLowerCase().includes(filter.trim().toLowerCase())) : list,
  );
  const emails = $derived([...new Set(shown.map((a) => a.email))]);

  const profiles = $derived(conditions.data?.config.profiles ?? {});
  const label = (id: string) => profiles[id]?.label ?? id;
  const when = (ms?: number) =>
    ms
      ? new Intl.DateTimeFormat('en-GB', {
          timeZone: 'Europe/London',
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        }).format(ms)
      : null;

  function describe(a: AlertView): string {
    const names = a.conditions.map(label);
    const what =
      names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} ${a.match === 'all' ? 'and' : 'or'} ${names.at(-1)}`;
    return `${what}${a.match === 'all' && names.length > 1 ? ' on the same day' : ''}`;
  }
  const days = (n: number) => (n === 1 ? 'today only' : n === 2 ? 'today and tomorrow' : `the next ${n} days`);

  function create() {
    editing = null;
    editorOpen = true;
  }
  function edit(a: AlertView) {
    editing = a;
    editorOpen = true;
  }
  async function saved(a: AlertView) {
    notice = editing ? `Saved “${a.label || describe(a)}”.` : `Alert created. It goes to ${a.email}.`;
    filter = filter || a.email;
    await load();
  }
  async function act(a: AlertView, what: 'pause' | 'test' | 'delete') {
    busy = `${a.id}:${what}`;
    notice = null;
    try {
      if (what === 'delete') {
        if (!confirm(`Delete “${a.label || describe(a)}” for ${a.email}?`)) return;
        await alerts.remove(a.id);
        notice = 'Alert deleted.';
      } else if (what === 'pause') {
        const { id: _id, createdAt: _c, updatedAt: _u, lastCheckedAt: _lc, lastSentAt: _ls, lastError: _le, ...input } = a;
        await alerts.update(a.id, { ...input, paused: !a.paused });
        notice = a.paused ? 'Alert resumed.' : 'Alert paused.';
      } else {
        const r = await alerts.test(a.id);
        notice =
          r.emails > 0
            ? `Test sent to ${a.email}${r.matches ? ` with ${r.matches} ${r.matches === 1 ? 'match' : 'matches'} from today’s forecast` : ', saying nothing matches right now'}.`
            : 'Nothing was sent.';
      }
      await load();
    } catch (e) {
      notice = (e as Error).message;
    } finally {
      busy = null;
    }
  }
</script>

<svelte:head><title>Alerts · Atmos</title></svelte:head>

<div class="page">
  <header class="top">
    <h1>Alerts</h1>
    {#if alerts.status}<button class="button" onclick={create}>New alert</button>{/if}
  </header>

  {#if alerts.status === null}
    <p class="muted">Checking the alerts service…</p>
  {:else if alerts.status === false}
    <section>
      <h2>Alerts aren’t running</h2>
      <p>
        Alerts need the <code>atmos-alerts</code> container beside Atmos. Add it to
        <code>docker-compose.yml</code> as in the README, fill in the email settings in <code>.env</code>, then
        <code>docker compose up -d</code>.
      </p>
    </section>
  {:else}
    <p class="intro">
      Atmos checks the forecast for each alert and emails when it matches. Alerts here are shared by everyone using
      this Atmos; each goes only to the address it names.
      {#if !alerts.status.email}
        <strong class="warn">Email isn’t set up yet, so nothing will be sent: fill in the SMTP settings in <code>.env</code>.</strong>
      {/if}
    </p>

    <label class="filter">
      <span>Show alerts for</span>
      <input type="search" bind:value={filter} placeholder="Everyone, or type an email" />
    </label>

    {#if notice}<p class="notice" role="status">{notice}</p>{/if}
    {#if loadError}<p class="warn">{loadError}</p>{/if}

    {#if shown.length === 0}
      <section>
        <p class="muted">
          {list.length ? 'No alerts for that address.' : 'No alerts yet.'} Create one here, or open a hill or loch and use
          <strong>Alert me</strong>.
        </p>
      </section>
    {/if}

    {#each emails as email (email)}
      <section>
        <h2>{email}</h2>
        <ul class="alerts">
          {#each shown.filter((a) => a.email === email) as a (a.id)}
            <li class:paused={a.paused}>
              <div class="what">
                <strong>{a.label || describe(a)}</strong>
                {#if a.label}<span class="small muted">{describe(a)}</span>{/if}
                <span class="small">
                  {a.places.map((p) => p.name).join(', ')}.
                  {a.minVerdict === 'go' ? 'Go only' : 'Maybe or better'},
                  {a.periods.map((p) => PERIOD_LABELS[p].toLowerCase()).join(', ')}, {days(a.daysAhead)}.
                </span>
                <span class="small muted">
                  {a.delivery.mode === 'daily' ? `Every day at ${a.delivery.at}` : 'As soon as it’s spotted'}{#if a.paused}; paused{/if}.
                  {#if a.lastSentAt}Last sent {when(a.lastSentAt)}.{:else if a.lastCheckedAt}Checked {when(a.lastCheckedAt)}, nothing to send yet.{/if}
                </span>
                {#if a.lastError}<span class="small warn">{a.lastError}</span>{/if}
              </div>
              <div class="actions">
                <button class="button quiet" onclick={() => edit(a)}>Change</button>
                <button class="button quiet" onclick={() => act(a, 'test')} disabled={busy !== null}>
                  {busy === `${a.id}:test` ? 'Sending…' : 'Send a test'}
                </button>
                <button class="button quiet" onclick={() => act(a, 'pause')} disabled={busy !== null}>{a.paused ? 'Resume' : 'Pause'}</button>
                <button class="button quiet danger" onclick={() => act(a, 'delete')} disabled={busy !== null}>Delete</button>
              </div>
            </li>
          {/each}
        </ul>
      </section>
    {/each}

    {#if alerts.status.lastRun}
      <p class="small muted">
        Last check {when(alerts.status.lastRun.at)}{alerts.status.lastRun.error ? `: ${alerts.status.lastRun.error}` : ''}.
      </p>
    {/if}
  {/if}
</div>

<AlertEditor bind:open={editorOpen} {editing} onSaved={saved} />

<style>
  .page {
    max-width: 760px;
    margin: 0 auto;
    padding: 24px 20px 40px;
    display: grid;
    gap: 18px;
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  h1 {
    margin: 0;
  }
  h2 {
    font-size: 1.05rem;
    margin: 0 0 8px;
  }
  .intro {
    margin: 0;
  }
  section {
    padding-top: 14px;
    border-top: 1px solid var(--line);
  }
  .filter {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .filter input {
    flex: 1;
    min-width: 220px;
    max-width: 360px;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 6px 8px;
    background: var(--paper);
    color: var(--ink);
    font: inherit;
  }
  .alerts {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  .alerts li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 10px 14px;
    align-items: start;
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 10px 12px;
    background: var(--paper);
  }
  .alerts li.paused {
    opacity: 0.65;
  }
  .what {
    display: grid;
    gap: 3px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: flex-end;
  }
  @media (max-width: 560px) {
    .alerts li {
      grid-template-columns: 1fr;
    }
    .actions {
      justify-content: flex-start;
    }
  }
  .notice {
    margin: 0;
    padding: 8px 12px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--go) 12%, var(--paper));
  }
  .warn {
    color: var(--no);
  }
  .danger {
    color: var(--no);
  }
  .muted {
    color: var(--ink-soft);
  }
</style>
