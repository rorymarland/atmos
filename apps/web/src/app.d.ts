/// <reference types="vite/client" />
// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
  /** Build-time defaults injected by vite.config.ts. */
  const __ATMOS_DEFAULTS__: { theme: 'light' | 'dark'; wind: 'kmh' | 'mph' };

  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

export {};
