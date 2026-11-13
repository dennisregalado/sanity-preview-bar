# sanity-preview-bar

A Shopify-style preview bar for sites built on [Sanity](https://www.sanity.io): the bar you get on a
Shopify theme preview, made of the Studio's own parts.

- **Perspective switcher:** the Studio's global perspective menu (published, drafts, content releases
  with their stacks and tones), switching instantly with no reload.
- **Short preview links:** "Copy preview link" makes a `/p/<code>` link that opens the page in the
  current perspective for 2 days, while Presentation's "Share this preview" is on. No secret in the
  URL.
- **Link search (⌘K):** the Studio's search over the pages you configure, with its virtualized list,
  previews and status dots. Picking a result navigates the site.
- **Workspace menu:** the Studio's own: the title and chevron open the project name, the workspace
  title, and "Manage project" / "Invite members" on sanity.io (the project ID comes from your
  Sanity client, or set `projectId`).
- **Visual Editor, Hide bar, Exit preview:** exit leaves preview in place, with no reload.

Everything is `@sanity/ui`, rendered in a same-origin iframe, so the bar's styles and the site's never
meet, and **React and Sanity UI never load outside preview mode**. The site side is a small
dependency-free module.

Adapters: **[SvelteKit](#sveltekit)** and **[Next.js](#nextjs-app-router)** (App Router).

## Install

```sh
npm install sanity-preview-bar
```

Peer dependencies: `react`, `react-dom` and `styled-components`. SvelteKit sites use
`@sanity/sveltekit`; Next.js sites use `next-sanity`'s draft mode. Any `@sanity/client` version works:
the bar only calls `withConfig` and `fetch`.

## SvelteKit

The adapter expects `@sanity/sveltekit`'s `handlePreviewMode`, so `event.locals.sanity` and the
`__sanity_preview` cookie are set up.

### 1. Configure the bar

```ts
// src/lib/server/preview-bar.ts
import {env} from 'cloudflare:workers' // or wherever your KV binding lives
import {createPreviewBar, kvStore} from 'sanity-preview-bar/server'
import {createSvelteKitPreviewBar} from 'sanity-preview-bar/sveltekit'
import {SANITY_PREVIEW_SECRET} from '$env/static/private'

export const previewBar = createSvelteKitPreviewBar({
  previewSecret: SANITY_PREVIEW_SECRET,
  bar: createPreviewBar({
    brand: {
      title: 'Acme',
      // Inline SVG (fill="currentColor" follows the bar's colours) or an image URL.
      logo: '<svg viewBox="0 0 24 24" width="22" height="23"><circle cx="12" cy="12" r="10" fill="currentColor"/></svg>',
      // The Sanity project's name, shown above the title in the workspace menu.
      project: 'Acme Website',
    },
    studioPath: '/studio',
    search: {
      routes: [
        {title: 'Homepage', path: '/', emoji: '🏡'},
        {title: 'Cart', path: '/cart', emoji: '🛒'},
      ],
      types: [
        {
          type: 'page',
          title: 'Page',
          fields: {title: 'title', slug: 'slug.current'},
          href: (slug) => `/pages/${slug}`,
        },
        {
          type: 'product',
          title: 'Product',
          emoji: '🛍️',
          fields: {
            title: 'store.title',
            slug: 'store.slug.current',
            image: 'store.previewImageUrl',
          },
          filter: 'store.isDeleted != true',
          href: (slug) => `/products/${slug}`,
        },
      ],
    },
    // Short links need a store with expiry: Workers KV here; `memoryStore()` for tests.
    links: {store: () => kvStore(env.PREVIEW_LINKS)},
  }),
})
```

`fields` are GROQ expressions, so computed values work (`coalesce(...)`, `"/policies/" +
slug.current`). Set `boost` to the plain field paths when a field is computed, so ranking matches the
Studio's, or `boost: {subtitle: null}` to rank on the title only.

### 2. Hooks

```ts
// src/hooks.server.ts
import {handlePreviewPerspective} from 'sanity-preview-bar/sveltekit'

export const handle = sequence(handleSanity /* handlePreviewMode */, handlePreviewPerspective)
```

`handlePreviewPerspective` applies the bar's perspective to `event.locals.sanity.client` and keeps
stega (and Visual Editing's overlays) to requests from inside Presentation, so a normal preview tab
renders clean, fast strings. Inside Presentation, call `markPresentationFetches()` (from
`sanity-preview-bar`) once in the browser so client-side data requests are marked too.

### 3. Routes

Each file is one line. They live outside your site's layout group so no site CSS or loaders run in
the bar's frame.

```ts
// src/routes/preview-bar/+page.server.ts
import {previewBar} from '$lib/server/preview-bar'
export const load = previewBar.loadBar

// src/routes/preview-bar/perspective/+server.ts
export const POST = previewBar.perspective
// src/routes/preview-bar/exit/+server.ts
export const POST = previewBar.exit
// src/routes/preview-bar/search/+server.ts
export const GET = previewBar.search
// src/routes/preview-bar/share/+server.ts
export const POST = previewBar.share

// src/routes/p/[code]/+page.server.ts
export const load = previewBar.openLink
```

```svelte
<!-- src/routes/preview-bar/+page.svelte -->
<script lang="ts">
  let {data} = $props()
  let target: HTMLDivElement | undefined = $state()
  $effect(() => {
    if (!target) return
    let unmount: (() => void) | undefined
    let cancelled = false
    import('sanity-preview-bar/bar').then(({mountPreviewBar}) => {
      if (!cancelled && target) unmount = mountPreviewBar(target, data)
    })
    return () => {
      cancelled = true
      unmount?.()
    }
  })
</script>

<div bind:this={target} style="height: 100%"></div>
```

```svelte
<!-- src/routes/p/[code]/+page.svelte: never renders; the load redirects or throws -->

<!-- src/routes/p/+error.svelte -->
<script lang="ts">
  import {page} from '$app/state'
  let target: HTMLDivElement | undefined = $state()
  $effect(() => {
    if (!target) return
    let unmount: (() => void) | undefined
    import('sanity-preview-bar/bar').then(({mountPreviewLinkError}) => {
      if (target)
        unmount = mountPreviewLinkError(target, {brand: {title: 'Acme'}, expired: page.status === 404})
    })
    return () => unmount?.()
  })
</script>

<div bind:this={target}></div>
```

### 4. Mount the host in your layout

```svelte
<!-- src/routes/(site)/+layout.svelte -->
<script lang="ts">
  import {goto, refreshAll} from '$app/navigation'
  import {page} from '$app/state'

  let {data, children} = $props() // `data.preview`: whether preview mode is on
  let host: import('sanity-preview-bar/host').PreviewBarHost | undefined = $state()

  $effect(() => {
    if (!data.preview || window.self !== window.top) return
    let cancelled = false
    import('sanity-preview-bar/host').then(({mountPreviewBarHost}) => {
      if (!cancelled) host = mountPreviewBarHost({refresh: refreshAll, navigate: goto})
    })
    return () => {
      cancelled = true
      host?.destroy()
      host = undefined
    }
  })

  $effect(() => host?.setPath(page.url.pathname + page.url.search))
</script>

{@render children()}
```

The host is a few KB with no dependencies, and loads only in preview.

### 5. Short links

- Create a KV namespace and bind it (`wrangler.jsonc` → `kv_namespaces`), or pass any store with
  `get` and `put(key, value, ttlSeconds)`.
- Add `Disallow: /p/` to `robots.txt`.
- Links are minted only while an editor has **Share this preview** on in Presentation; while it's off
  the button opens Presentation instead.

## Next.js (App Router)

The adapter expects `next-sanity`'s draft mode (`defineEnableDraftMode`) and reads the same
`sanity-preview-perspective` cookie as `resolvePerspectiveFromCookies`, so the bar and Presentation
stay in step.

### 1. Configure the bar

```ts
// lib/sanity/preview-bar.ts
import {getCloudflareContext} from '@opennextjs/cloudflare' // or your KV/Redis client
import {createPreviewBar, kvStore} from 'sanity-preview-bar/server'
import {createNextPreviewBar} from 'sanity-preview-bar/next'
import {client} from '@/sanity/lib/client'
import {token} from '@/sanity/lib/token'

export const PREVIEW_BAR_BRAND = {title: 'Acme', logo: 'https://…/mark.png'}

export const previewBar = createNextPreviewBar({
  client: client.withConfig({token}),
  bar: createPreviewBar({
    brand: PREVIEW_BAR_BRAND,
    studioPath: '/studio',
    search: {routes: [{title: 'Homepage', path: '/'}], types: [/* as for SvelteKit */]},
    links: {store: () => kvStore(getCloudflareContext().env.PREVIEW_LINKS)},
  }),
})
```

### 2. Routes

Put them in a route group with its own bare root layout (`<html><body>{children}</body></html>`), so
no site CSS, fonts or providers load in the bar's frame.

```ts
// app/(preview)/preview-bar/[action]/route.ts
export const {GET, POST} = previewBar.handlers

// app/(preview)/preview-bar/open/[code]/route.ts
export const GET = previewBar.openLink
```

```tsx
// app/(preview)/preview-bar/page.tsx
import {PreviewBarFrame} from 'sanity-preview-bar/next/client'
export const dynamic = 'force-dynamic'
export default async function Page() {
  return <PreviewBarFrame data={await previewBar.loadBar()} />
}

// app/(preview)/p/[code]/page.tsx: live links redirect into draft mode, dead ones 404
import {PreviewLinkErrorFrame} from 'sanity-preview-bar/next/client'
export const dynamic = 'force-dynamic'
export default async function Page({params}: {params: Promise<{code: string}>}) {
  await previewBar.checkLink((await params).code)
  return <PreviewLinkErrorFrame brand={PREVIEW_BAR_BRAND} expired={false} />
}

// app/(preview)/p/[code]/not-found.tsx
export default function NotFound() {
  return <PreviewLinkErrorFrame brand={PREVIEW_BAR_BRAND} expired />
}
```

Opening a link takes two hops because a page can't set cookies while rendering: `/p/<code>` checks
the link and redirects to `/preview-bar/open/<code>`, which enables draft mode and redirects to the
stored page.

### 3. Mount the host in your layout

```tsx
import {PreviewBarHost} from 'sanity-preview-bar/next/client'

// in the site's root layout, after the page:
{
  ;(await draftMode()).isEnabled && <PreviewBarHost />
}
```

The host refreshes with `router.refresh()` and navigates with `router.push()`.

### Visual Editing outside Presentation

Render `<VisualEditing />` only inside the Studio's Presentation tool (for example when
`window.self !== window.top`). In a normal draft-mode tab its overlays re-parse the page on every
change and can loop ("Maximum update depth exceeded"), which starves client-side navigation, the
bar's included.

## How it works

- **The frame:** the host pins a full-viewport iframe to the bottom of a bar-height wrapper in the top
  layer (a manual popover) that clips it. When a menu, tooltip or dialog opens, the bar asks the host
  to stop clipping, and to clip again 250ms after the last one closes so exit animations play.
- **Messages:** the host and bar talk through `postMessage` on the site's own origin only
  (`sanity-preview-bar:*`).
- **Perspective:** stored in Sanity's own `sanity-preview-perspective` cookie, the one Presentation
  uses, so the two stay in step.
- **Studio fidelity:** release ordering, stacks, tones, search scoring and many sizes are copied from
  `sanity@6.23` internals. `test/preview-perspective.test.ts` checks `sortReleases` against the
  installed `sanity`; re-check the rest when Sanity changes them.

## License

MIT © Dennis Regalado
