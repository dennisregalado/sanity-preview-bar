# sanity-preview-bar

A Shopify-style preview bar for sites built on [Sanity](https://www.sanity.io): the bar you get on a
Shopify theme preview, made of the Studio's own parts.

- **Perspective switcher:** the Studio's global perspective menu (published, drafts, content releases
  with their stacks and tones), switching instantly with no reload.
- **Share preview:** Presentation's share menu: the "Share this preview" switch, a QR code to open
  the preview on a phone, and "Copy preview link". The link is a short `/p/<code>` link that opens
  the page in the current perspective for 2 days, with no secret in the URL.
- **Link search (⌘K):** the Studio's search over the pages you configure, with its virtualized list,
  previews and status dots. Picking a result navigates the site.
- **Workspace menu:** the Studio's own: the title and chevron open the project name, the workspace
  title, and "Manage project" / "Invite members" on sanity.io (the project ID comes from your
  Sanity client, or set `projectId`).
- **Visual Editor, Hide bar, Exit preview:** exit leaves preview in place, with no reload.
- **For signed-in editors (Studio layer):** with your Studio config passed to the bar, editors
  signed in to the embedded Studio get the Studio's own search (native previews and filters).
  Everyone else gets "Sign in", which opens the Studio's own sign-in.
- **Document pane (optional):** an **Edit** button opens this page's document in the Studio's own
  document editor, in a pane on the right of the page: the pane Presentation shows, with the
  Published / Draft chips, the form, presence, comments and Publish. The page reflows beside it and
  stays clickable.
- **Visual Editor tool (optional):** a Studio tool with Presentation's layout and the bar: the bar
  on top, the site in the middle (desktop, or a 375px phone with Presentation's width animation),
  and the Studio's document pane on the right. **Edit** on the site opens the page there.

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

`handlePreviewPerspective` applies the bar's perspective to `event.locals.sanity.client`, without
stega, so preview pages render clean, fast strings.

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

The bar sits at the bottom by default. Pass `position: 'top'` to `mountPreviewBarHost` to put it at
the top: the page gets `padding-top` instead, and the bar's menus and tooltips open downward. Fixed
or sticky headers at `top: 0` don't move, so they sit under the bar.

### 5. Studio layer (optional)

```ts
// In createPreviewBar: the Presentation tool's `resolve.mainDocuments` list (finds the page's
// document for the document pane)
pageDocuments: MAIN_DOCUMENTS,

// src/routes/preview-bar/resolve/+server.ts
export const GET = previewBar.resolveHref
// src/routes/preview-bar/document/+server.ts
export const GET = previewBar.pageDocument
```

On the bar page, pass a loader for your Studio config as the third argument:
`mountPreviewBar(target, data, {studioConfig: () => import('../../../sanity.config').then((m) => m.default)})`.
`sanity` and the config load only for signed-in editors.

**Document pane:** add `documentPane: true` to the same options:
`mountPreviewBar(target, data, {studioConfig, documentPane: true})`. Signed-in editors get an
**Edit** button (in place of Visual Editor) whenever the page has a document (from
`pageDocuments`). It opens the Studio's document pane in a column on the left (or right), top to
bottom of the viewport, and the bar narrows to sit beside it. The button hides while the pane is open; the
pane's own × closes it, and `E` (when you're not typing, on the page or in the bar) toggles it. On
viewports too narrow to keep 360px beside the pane, the pane overlays the page above a full-width
bar.

```ts
mountPreviewBar(target, data, {
  studioConfig,
  // Optional settings instead of `true`:
  documentPane: {allFieldsGroup: false, side: 'right'},
})
```

- `side`: `'left'` (default) or `'right'`.

- `allFieldsGroup: false` hides field groups' **All fields** tab in the pane only (Sanity's
  `ALL_FIELDS_GROUP` with `hidden: true`, added to the bar's copy of your config). As in the Studio,
  fields outside every group then don't show.

- The real editor: the same `DocumentPane` Presentation renders, built from public
  `sanity/structure` exports, with your Studio config's plugins, inputs, actions and badges. Your
  `studio.components.layout` middleware wraps it (Comments and Tasks keep their providers there), so
  layout plugins that draw their own UI around the Studio would draw it around the pane too.
- It edits in the bar's perspective: drafts, or the selected release's version.
- Reference links open the referenced document in the pane; the pane's × goes back, then closes.
- **Create new document** (the Studio navbar's "+", left of search): the workspace's own
  new-document options with their permissions, filtered like the Studio's. The new document opens
  in the pane (on top of the page's, so × goes back); nothing is saved until you edit it. Without
  the pane, it opens the Studio's create intent in a new tab.
- Presentation's "Preview this page" locations banner is hidden in the pane: you're already on the
  page.
- The pane follows the page: navigating the site opens the new page's document. It stays open
  across reloads for the tab (`sessionStorage`), and through pages without a document.
- Drag its inner edge (or focus it and use the arrow keys) to resize it, from 320px up to leaving
  360px of page; the width is remembered (`localStorage`).
- Studio links inside it: an edit intent opens that document in the pane; links to other tools open
  the Studio in a new tab.
- The bar follows the Studio's own appearance setting (light, dark or system), like the pane.
- The pane's own Published / Draft / release chips switch the site too, like the bar's menu.
- The host clips the frame to the bar plus the pane's column (`clip-path`), so the rest of the page
  stays clickable, and pads `<html>` on the pane's side so the page reflows. Fixed-position
  elements on your site don't reflow; dialogs and popovers that reach past the pane unclip the frame
  while they're open.
- Anything that streams the form's value (a document-level `form.components.input`, like
  Presentation's) runs in the pane too, so a realtime preview updates as editors type.

### 6. Visual Editor tool (optional)

A Studio tool with Presentation's layout and the preview bar. The Studio's own document pane runs
top to bottom on the right, following the page; beside it, the bar (rendered natively in the
Studio, with its context) sits above the framed site, at desktop width, as a 768px tablet or as a
375px phone (the bar's viewport menu animates between them). Typing updates the framed page
as fast as a normal preview tab: it reads like one (no stega), so the same live updates apply.

The bar's data comes from the Studio, not the site: the workspace (title, icon, project), the live
releases, the Studio's perspective and Presentation's sharing state. So the bar renders with the
tool, like Presentation's toolbar; the page and the pane each show a skeleton until theirs is in.

```ts
// sanity.config.ts
import {defineDocuments, defineLocations, visualEditorTool} from 'sanity-preview-bar/studio'

plugins: [
  visualEditorTool({
    // Like Presentation's `previewUrl`: the first page, and the site's preview-mode route.
    previewUrl: {initial: '/', previewMode: {enable: '/preview/enable'}},
    // Presentation's document resolvers, with its API (the same lists work in both tools).
    resolve: {
      // Which document each page shows: the pane opens it as you browse.
      mainDocuments: defineDocuments([
        {route: '/products/:slug', filter: `_type == "product" && slug.current == $slug`},
      ]),
      // Where each document appears: "Used on N pages" above its form, each page opening here.
      locations: {
        product: defineLocations({
          select: {title: 'title', slug: 'slug.current'},
          resolve: (doc) => ({
            locations: [{title: doc?.title || 'Untitled', href: `/products/${doc?.slug}`}],
          }),
        }),
      },
    },
    // Optional: the types the bar's search opens filtered to; `links: false` without short links.
    searchTypes: ['page', 'product'],
  }),
]
```

The tool replaces Presentation: `mainDocuments` takes all three of its forms (`type`,
`filter`/`params`, `resolve`), and `locations` its per-type `{select, resolve}` resolvers, fixed
states, or one function for every type. The locations banner is Presentation's, hidden in the bar's
own panes, which sit beside the page already.

On the bar page, `visualEditor: true` makes **Edit** open the current page in the tool (same tab):
`mountPreviewBar(target, data, {studioConfig, visualEditor: true})`. With `documentPane` as well,
`E` still opens the pane on the site.

In your layout, the framed site answers the tool instead of mounting the host
(`isPreviewBarFrame()` tells the tool's frame from any other):

```ts
import {isPreviewBarFrame} from 'sanity-preview-bar'

$effect(() => {
  const frame = isPreviewBarFrame()
  if (!data.preview || (window.self !== window.top && !frame)) return
  import('sanity-preview-bar/host').then(({mountPreviewBarHost, mountPreviewBarFrame}) => {
    const options = {refresh: refreshAll, navigate: goto}
    host = frame ? mountPreviewBarFrame(options) : mountPreviewBarHost(options)
  })
})
```

- In the tool, the bar's **Edit** and **Create new document** open documents in the tool's pane,
  search results without a page open there too, and the pane's × goes back, then closes.
- Perspective goes both ways: the bar's switcher moves the Studio's perspective, and the pane's
  chips or the Studio's own menu switch the bar and the site.
- In the tool the bar's "…" menu (Hide bar, Exit preview) gives way to **Exit Visual Editor**,
  which opens the current page on the site, where its own bar takes over.
- The Studio's navbar is hidden while the tool is open, so the bar is the only toolbar; its logo goes
  back to the Studio. `hideStudioNavbar: false` keeps the navbar.
- The tool enables preview mode as Presentation does (a preview secret through `previewMode.enable`)
  and keeps `?preview=` in the Studio's URL in step with the page.
- The bar and the site are framed on the site's origin, which has to be the Studio's: an embedded
  Studio (as in the SvelteKit and Next.js setups above).

### 7. Short links

- Create a KV namespace and bind it (`wrangler.jsonc` → `kv_namespaces`), or pass any store with
  `get` and `put(key, value, ttlSeconds)`.
- Add `Disallow: /p/` to `robots.txt`.
- Links are minted only while **Share this preview** is on. The switch in the bar's share menu is
  Sanity's preview sharing setting, the one Presentation's share menu toggles (signed-in editors can
  toggle it; others see it read-only), and turning it off stops new links. Links already handed out keep working until they
  expire.

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

### Visual Editing

The bar doesn't use `<VisualEditing />` or stega. If a site renders `<VisualEditing />`, keep it
out of normal draft-mode tabs and the Visual Editor's frame: its overlays re-parse the page on every
change and can loop ("Maximum update depth exceeded"), which starves client-side navigation, the
bar's included.

### Click to edit

Mark editable elements with Sanity's own attribute, in preview mode only:

```html
<h2 data-sanity="id=page-home;type=page;path=sections:k1.heading">…</h2>
```

`id` is the published id; `path` is Sanity's URL path form (`.` between fields, `field:key` for a
keyed array item, `field:3` for an index). `createDataAttribute` from `@sanity/visual-editing`
writes the same thing; so does a hand-written helper. `base=` and `workspace=` are ignored, and an
attribute without a path isn't a target.

Hovering a marked element outlines it and labels its field (with the editable elements above it as
a breadcrumb); clicking it opens that document in the document pane at the path. The page's own
document opens there (an array item opens its editor, a field gets focus); any other document
opens above it in the pane, and × goes back. It works in the Visual Editor tool only, while the
bar's inspector is on (its "Activate inspector" button, or <kbd>⌘⇧I</kbd> / <kbd>Ctrl+Shift+I</kbd>
in the bar or on the page; remembered for the tab). The site's own preview bar has no inspector.

- **Labels** are the Studio's own titles: the section's type and the field (`Image Hero › Title`),
  a block by its style (`Heading 1`), a reference by what it points to. The Visual Editor resolves
  them from the schema and the document, so the schema never ships to the page.
- **Focus from the pane:** the field the editor is in is outlined on the page, and scrolled into
  view when it's off screen. A field without its own annotation outlines the nearest one around it.
- **Drift check:** while the inspector is on, every annotation on the page is checked against the
  schema and the document (when the page is idle, and again when its annotations change). One that
  doesn't resolve, say a field renamed in the schema but not in the component, gets a dashed red
  outline, a red label and a console warning.

- Hold <kbd>Alt</kbd> / <kbd>⌥</kbd> to hide the outlines and let clicks through to the page.
- <kbd>Esc</kbd> clears the hover outline until the pointer moves.

Pass `clickToEdit: false` to `mountPreviewBarFrame` to leave it out.
`mountClickToEdit` (from `sanity-preview-bar/host`) runs the engine on its own; `npm run example`
serves a demo page.

## How it works

- **The frame:** the host pins a full-viewport iframe to the bottom of a bar-height wrapper in the top
  layer (a manual popover) that clips it. When a menu, tooltip or dialog opens, the bar asks the host
  to stop clipping, and to clip again 250ms after the last one closes so exit animations play.
- **Document pane:** the frame's wrapper grows to the viewport and a `clip-path` cuts it to an L
  (the pane's full-height column, left or right, plus the narrowed bar); clipped-out areas take no pointer events.
- **Messages:** the host and bar talk through `postMessage` on the site's own origin only
  (`sanity-preview-bar:*`).
- **Click to edit:** no registry and no observers. One passive `pointermove` listener, coalesced
  to an animation frame, hit-tests with `closest('[data-sanity]')`; the outline is one fixed,
  shadow-rooted layer positioned from `getBoundingClientRect`, so it stays on sticky content.
  Clicks are intercepted in the capture phase and sent as `sanity-preview-bar:edit`.
- **Perspective:** stored in Sanity's own `sanity-preview-perspective` cookie, the one Presentation
  uses, so the two stay in step.
- **Studio fidelity:** release ordering, stacks, tones, search scoring and many sizes are copied from
  `sanity@6.23` internals. `test/preview-perspective.test.ts` checks `sortReleases` against the
  installed `sanity`; re-check the rest when Sanity changes them.

## License

MIT © Dennis Regalado
