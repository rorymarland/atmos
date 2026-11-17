<script lang="ts">
  /** A small spinning ring for "still working". Holds still for reduced motion. */
  let { label = 'Working' }: { label?: string } = $props();
</script>

<span class="spinner" role="status" aria-label={label}></span>

<style>
  .spinner {
    display: inline-block;
    flex: none;
    width: 1.1em;
    height: 1.1em;
    border: 2.5px solid var(--line);
    border-top-color: var(--ink);
    border-radius: 50%;
    vertical-align: -0.15em;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation: none;
      border-top-color: var(--line);
      border-right-color: var(--ink);
    }
  }
</style>
