// @ts-check
import { defineConfig } from 'astro/config';
import marbleStudio from './src/studio/integration.mjs';

// While the site is previewed at silviavaelk.github.io/site, everything lives
// under /site. When silviavaelk.com points here, set SITE_BASE to "/" (or
// change the default below) and SITE_URL to https://www.silviavaelk.com.
export default defineConfig({
  site: process.env.SITE_URL ?? 'https://silviavaelk.github.io',
  base: process.env.SITE_BASE ?? '/site',
  trailingSlash: 'ignore',
  // Adds /studio while running `npm run dev` (never published)
  integrations: [marbleStudio()],
});
