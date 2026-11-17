<script lang="ts">
  /** The favourite toggle: an outlined star, filled when the hill is a favourite. */
  let {
    on,
    name,
    onToggle,
    size = 18,
  }: { on: boolean; name: string; onToggle: () => void; size?: number } = $props();
</script>

<button
  type="button"
  class="star"
  class:on
  aria-pressed={on}
  aria-label={on ? `Remove ${name} from favourites` : `Add ${name} to favourites`}
  title={on ? 'Remove from favourites' : 'Add to favourites'}
  onmousedown={(e) => {
    // Inside the search list: don't blur the box or choose the row.
    e.preventDefault();
    e.stopPropagation();
  }}
  onclick={(e) => {
    e.stopPropagation();
    onToggle();
  }}
>
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z"
      stroke-width="1.8"
      stroke-linejoin="round"
    />
  </svg>
</button>

<style>
  .star {
    flex: none;
    display: inline-grid;
    place-items: center;
    padding: 4px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--ink-soft);
    cursor: pointer;
  }
  .star:hover {
    background: var(--surface);
    color: var(--ink);
  }
  .star:focus-visible {
    outline: 2px solid var(--focus);
  }
  path {
    fill: none;
    stroke: currentColor;
  }
  .on {
    color: var(--star, #d4a017);
  }
  .on:hover {
    color: var(--star, #d4a017);
  }
  .on path {
    fill: currentColor;
  }
</style>
