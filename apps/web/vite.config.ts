import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    sveltekit({
      adapter: adapter({ precompress: true }),
      // Display defaults come from static/defaults.js at run time (rewritten by the
      // container from .env), so the image doesn't need rebuilding to change them.
    }),
  ],
});
