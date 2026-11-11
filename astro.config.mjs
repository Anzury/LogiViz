import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';

// Locally the site is served from the root. When it is published, the deployment
// workflow says through these two variables at which address and under which
// folder it ends up (see .github/workflows/deploy.yml).
const { SITE_URL, BASE_PATH } = process.env;

export default defineConfig({
  site: SITE_URL,
  base: BASE_PATH ?? '/',
  integrations: [mdx()],
  server: { port: 4321 },
});
