<script lang="ts">
  import { conditions } from '#lib/conditions.svelte.ts';
</script>

<svelte:head><title>Atmos: about and data sources</title></svelte:head>

<div class="page">
  <h1>About Atmos</h1>
  <p>
    Atmos ranks UK hills and zones for walking and landscape photography by blending weather models
    and explaining every verdict. Each zone is forecast at one valley point; summit conditions come
    from the model’s upper levels at the summit’s height.
  </p>
  <p class="safety">
    Atmos is a guide, not a safety service. Inversions, fog and low cloud are among the hardest
    things for any model to forecast. Always check the
    <a href="https://www.metoffice.gov.uk/weather/specialist-forecasts/mountain" target="_blank" rel="noopener">Met Office mountain forecast</a>
    and <a href="https://www.mwis.org.uk/" target="_blank" rel="noopener">MWIS</a> before you go.
  </p>

  <h2>Data sources</h2>
  {#if conditions.data}
    <table>
      <thead><tr><th>Source</th><th>Used for</th><th>Licence</th></tr></thead>
      <tbody>
        {#each conditions.data.attributions as a (a.id)}
          <tr>
            <td><a href={a.url} target="_blank" rel="noopener">{a.name}</a></td>
            <td>{a.use}{#if a.terms}. {a.terms}{/if}</td>
            <td>{a.licence}</td>
          </tr>
        {/each}
        <tr>
          <td><a href="https://mapterhorn.com/attribution" target="_blank" rel="noopener">Mapterhorn</a></td>
          <td>Hill shading on the map</td>
          <td>Attribution required</td>
        </tr>
      </tbody>
    </table>
  {:else}
    <p class="muted">Loading…</p>
  {/if}

  <h2>Licence</h2>
  <p>
    Atmos is source-available under the PolyForm Noncommercial License 1.0.0: free for private and
    non-commercial use. The source is on <a href="https://github.com/rorymarland/atmos" target="_blank" rel="noopener">GitHub</a>.
  </p>
</div>

<style>
  .page {
    max-width: 720px;
    margin: 0 auto;
    padding: 24px 20px 40px;
    display: grid;
    gap: 14px;
  }
  .page > p {
    max-width: 66ch;
  }
  h2 {
    margin-top: 12px;
  }
  .safety {
    border-left: 3px solid var(--gold);
    padding-left: 12px;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 0.92rem;
  }
  th,
  td {
    text-align: left;
    padding: 8px 10px 8px 0;
    border-bottom: 1px solid var(--line);
    vertical-align: top;
  }
  th {
    color: var(--ink-soft);
    font-weight: 600;
  }
</style>
