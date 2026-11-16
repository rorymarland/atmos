import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

/**
 * Build-time defaults, from the environment (see .env.example). They're baked into the
 * static files, so changing one needs a rebuild. Settings chosen in the app override them.
 */
const defaults = {
  theme: process.env.ATMOS_DEFAULT_THEME === 'dark' ? 'dark' : 'light',
  wind: process.env.ATMOS_DEFAULT_WIND_UNIT === 'mph' ? 'mph' : 'kmh',
};

export default defineConfig({
  plugins: [
    sveltekit({
      adapter: adapter({ precompress: true }),
    }),
  ],
  define: {
    __ATMOS_DEFAULTS__: JSON.stringify(defaults),
  },
});
