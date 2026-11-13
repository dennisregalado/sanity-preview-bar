import {defineConfig} from '@sanity/pkg-utils'

const entries = {
  '.': 'core/index',
  './bar': 'bar/index',
  './host': 'host/index',
  './server': 'server/index',
  './sveltekit': 'sveltekit/index',
  './next': 'next/index',
  './next/client': 'next/client',
}

export default defineConfig({
  dist: 'dist',
  tsconfig: 'tsconfig.dist.json',
  exports: Object.fromEntries(
    Object.entries(entries).map(([subpath, source]) => {
      const out = subpath === '.' ? 'index' : subpath.slice(2).replace('/', '-')
      const ext = source === 'next/client' ? 'tsx' : 'ts'
      return [
        subpath,
        {source: `./src/${source}.${ext}`, import: `./dist/${out}.js`, default: `./dist/${out}.js`},
      ]
    }),
  ),
  // Framework packages stay imports in the output.
  // Kept as bare specifiers: Next swaps `next/headers` and `next/navigation` for route-handler
  // builds only when they're imported by name, not as `next/navigation.js`.
  deps: {neverBundle: [/^@sveltejs\/kit(\/.*)?$/, /^next(\/.*)?$/]},
  // No release tags (`@public`/`@beta`) on this API yet.
  tsdoc: false,
})
