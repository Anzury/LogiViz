import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';

// Locally the site is served from the root. When it is published, the deployment
// workflow says through these two variables at which address and under which
// folder it ends up (see .github/workflows/deploy.yml).
const { SITE_URL, BASE_PATH } = process.env;

/**
 * Design studies are pages that only `npm run dev` serves: they are working
 * documents, not part of the published site.
 */
const studies = {
  name: 'logiviz-studies',
  hooks: {
    'astro:config:setup': ({ command, injectRoute }) => {
      if (command === 'dev') injectRoute({ pattern: '/etude-pixel', entrypoint: './src/etudes/pixel.astro' });
    },
  },
};

export default defineConfig({
  site: SITE_URL,
  base: BASE_PATH ?? '/',
  integrations: [mdx(), studies],
  server: { port: 4321 },
});
