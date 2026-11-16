/// <reference types="vite/client" />
// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
  interface Window {
    /** Display defaults from /defaults.js, written by the container at start-up. */
    __ATMOS_DEFAULTS__?: { theme?: string; wind?: string };
  }

  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

export {};
