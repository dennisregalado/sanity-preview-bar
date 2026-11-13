import {defineConfig} from '@sanity/pkg-utils'

const entries = {
  '.': 'core/index',
  './bar': 'bar/index',
  './host': 'host/index',
  './server': 'server/index',
  './sveltekit': 'sveltekit/index',
}

export default defineConfig({
  dist: 'dist',
  tsconfig: 'tsconfig.dist.json',
  exports: Object.fromEntries(
    Object.entries(entries).map(([subpath, source]) => {
      const out = subpath === '.' ? 'index' : subpath.slice(2)
      return [
        subpath,
        {source: `./src/${source}.ts`, import: `./dist/${out}.js`, default: `./dist/${out}.js`},
      ]
    }),
  ),
  // Framework packages stay imports in the output.
  deps: {neverBundle: ['@sveltejs/kit']},
  // No release tags (`@public`/`@beta`) on this API yet.
  tsdoc: false,
})
