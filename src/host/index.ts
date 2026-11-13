/**
 * The site side of the bar, with no React or Sanity UI: a same-origin iframe framing the bar's
 * route, mounted only in preview mode. Framework adapters call `mountPreviewBarHost` with their own
 * `refresh` (rerun the page's data in place) and `navigate` (client-side navigation).
 *
 * Same layout as Shopify's theme preview bar: the frame is always a full viewport tall and pinned to
 * the bottom of a bar-height wrapper that clips it. Opening a menu only stops the clipping, so the
 * frame's viewport never changes and its popovers position once, with no relayout. The wrapper is a
 * manual popover, so it sits in the top layer above every stacking context.
 */
import {
  isPreviewBarMessage,
  PREVIEW_BAR_HEIGHT,
  PREVIEW_BAR_ROUTE,
  type PreviewBarMessage,
} from '../core/protocol'

export type PreviewBarHostOptions = {
  /** The bar's route. Default `/preview-bar`. */
  basePath?: string
  /** Reruns the page's data in place, no reload (SvelteKit `refreshAll`, Next.js `router.refresh`). */
  refresh: () => unknown
  /** Client-side navigation to a root-relative href (SvelteKit `goto`, Next.js `router.push`). */
  navigate: (href: string) => unknown
  /** The current path and query. Default `location.pathname + location.search`. */
  path?: string
}

export type PreviewBarHost = {
  /** Tell the bar the page changed (call after every client-side navigation). */
  setPath(path: string): void
  destroy(): void
}

/**
 * Whether this window should show the bar: the top window only. Inside the Studio's Presentation
 * iframe the Studio has its own chrome, and other embeds (thumbnails) shouldn't get a bar.
 */
export function isTopWindow() {
  return typeof window !== 'undefined' && window.self === window.top
}

function currentPath() {
  return window.location.pathname + window.location.search
}

export function mountPreviewBarHost(options: PreviewBarHostOptions): PreviewBarHost {
  const basePath = options.basePath ?? PREVIEW_BAR_ROUTE
  let path = options.path ?? currentPath()
  let destroyed = false

  const wrapper = document.createElement('div')
  wrapper.setAttribute('popover', 'manual')
  wrapper.dataset.sanityPreviewBar = ''
  // Overrides the UA popover box (centred, bordered, padded, opaque). `z-index` only matters in
  // browsers without the Popover API, where the wrapper is not in the top layer.
  Object.assign(wrapper.style, {
    position: 'fixed',
    inset: 'auto 0 0 0',
    zIndex: '2147483000',
    boxSizing: 'border-box',
    width: '100%',
    height: `calc(${PREVIEW_BAR_HEIGHT}px + env(safe-area-inset-bottom, 0px))`,
    margin: '0',
    padding: '0',
    border: '0',
    overflow: 'hidden',
    background: 'transparent',
  } satisfies Partial<CSSStyleDeclaration>)

  const iframe = document.createElement('iframe')
  iframe.src = basePath
  iframe.title = 'Sanity preview bar'
  iframe.allow = 'clipboard-write'
  iframe.setAttribute(
    'sandbox',
    'allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox allow-top-navigation',
  )
  Object.assign(iframe.style, {
    position: 'absolute',
    bottom: 'env(safe-area-inset-bottom, 0px)',
    left: '0',
    display: 'block',
    width: '100%',
    height: '100dvh',
    border: '0',
    colorScheme: 'normal',
  } satisfies Partial<CSSStyleDeclaration>)

  wrapper.appendChild(iframe)
  document.body.appendChild(wrapper)
  if ('showPopover' in wrapper) wrapper.showPopover()

  // Reserve room so the bar never covers the footer.
  const root = document.documentElement
  root.style.setProperty('padding-bottom', `${PREVIEW_BAR_HEIGHT}px`)

  function post(message: PreviewBarMessage) {
    iframe.contentWindow?.postMessage(message, window.location.origin)
  }

  function hide() {
    destroy()
  }

  function onMessage(event: MessageEvent) {
    if (event.origin !== window.location.origin || event.source !== iframe.contentWindow) return
    if (!isPreviewBarMessage(event.data)) return
    switch (event.data.type) {
      case 'sanity-preview-bar:ready':
        post({type: 'sanity-preview-bar:path', path})
        break
      case 'sanity-preview-bar:hide':
        hide()
        break
      // While a menu, tooltip or dialog is open the transparent frame stops being clipped so it
      // can draw above the bar; a click outside lands in the frame and closes it.
      case 'sanity-preview-bar:menu':
        wrapper.style.overflow = event.data.open ? 'visible' : 'hidden'
        break
      case 'sanity-preview-bar:navigate':
        void options.navigate(event.data.href)
        break
      case 'sanity-preview-bar:refresh':
        Promise.resolve()
          .then(() => options.refresh())
          .finally(() => post({type: 'sanity-preview-bar:refreshed'}))
        break
    }
  }

  // ⌘K / Ctrl+K on the page opens the bar's search, like the Studio's shortcut.
  function onKeyDown(event: KeyboardEvent) {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return
    event.preventDefault()
    post({type: 'sanity-preview-bar:search'})
  }

  window.addEventListener('message', onMessage)
  window.addEventListener('keydown', onKeyDown)

  function destroy() {
    if (destroyed) return
    destroyed = true
    window.removeEventListener('message', onMessage)
    window.removeEventListener('keydown', onKeyDown)
    root.style.removeProperty('padding-bottom')
    wrapper.remove()
  }

  return {
    setPath(next) {
      path = next
      // Before the bar's `ready` this posts into an empty frame and is dropped; `ready` resends it.
      post({type: 'sanity-preview-bar:path', path})
    },
    destroy,
  }
}
