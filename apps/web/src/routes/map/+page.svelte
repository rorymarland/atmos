<script lang="ts">
  // The map is now the home page; keep old /map links working.
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  onMount(() => goto('/', { replace: true }));
</script>
