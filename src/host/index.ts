/**
 * The site side of the bar, with no React or Sanity UI: a same-origin iframe framing the bar's
 * route, mounted only in preview mode. Framework adapters call `mountPreviewBarHost` with their own
 * `refresh` (rerun the page's data in place) and `navigate` (client-side navigation).
 *
 * Same layout as Shopify's theme preview bar: the frame is always a full viewport tall and pinned to
 * the bar's edge (bottom by default, or top) of a bar-height wrapper that clips it. Opening a menu only stops the clipping, so the
 * frame's viewport never changes and its popovers position once, with no relayout. The wrapper is a
 * manual popover, so it sits in the top layer above every stacking context.
 *
 * With the document pane open the wrapper grows to the full viewport and a `clip-path` cuts it to
 * an L: the pane's full-height column (on the left or right) plus the bar, which narrows to sit
 * beside it. Clipped-out areas take no pointer events, so the rest of the page stays clickable,
 * and the page gets padding on the pane's side so its content reflows beside the pane.
 */
import {
  isPreviewBarMessage,
  PREVIEW_BAR_HEIGHT,
  PREVIEW_BAR_ROUTE,
  PREVIEW_BAR_POSITION_PARAM,
  PREVIEW_PANEL_MIN_PAGE_WIDTH,
  type PaneSide,
  type PreviewBarMessage,
  type PreviewBarPosition,
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
  /**
   * Which edge the bar sits on. Default `'bottom'`, which never covers the site's own header.
   * With `'top'` the page gets `padding-top`; fixed or sticky headers at `top: 0` don't move and
   * sit under the bar.
   */
  position?: PreviewBarPosition
}

export type PreviewBarHost = {
  /** Tell the bar the page changed (call after every client-side navigation). */
  setPath(path: string): void
  destroy(): void
}

/**
 * Whether this window should show the bar: the top window only. The Studio's Visual Editor frames
 * the site with its own bar, and other embeds (thumbnails) shouldn't get one.
 */
export function isTopWindow() {
  return typeof window !== 'undefined' && window.self === window.top
}

function isEditable(target: EventTarget | null) {
  const element = target as HTMLElement | null
  return Boolean(
    element?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]'),
  )
}

function currentPath() {
  return window.location.pathname + window.location.search
}

/** The bar's height including the safe area on its edge, as a CSS length. */
function barHeight(position: PreviewBarPosition) {
  return `(${PREVIEW_BAR_HEIGHT}px + env(safe-area-inset-${position}, 0px))`
}

/**
 * The frame's clip while the pane is open: the union of the pane's full-height column (`side`) and
 * the bar's full-width strip (`position`), as a polygon in the wrapper's coordinates.
 */
export function panelClipPath(
  side: PaneSide,
  position: PreviewBarPosition,
  width: number,
  barHeightCss: string,
) {
  const inner = side === 'right' ? `calc(100% - ${width}px)` : `${width}px`
  const strip = position === 'bottom' ? `calc(100% - ${barHeightCss})` : `calc${barHeightCss}`
  const points =
    position === 'bottom'
      ? side === 'right'
        ? [`0 ${strip}`, `${inner} ${strip}`, `${inner} 0`, '100% 0', '100% 100%', '0 100%']
        : ['0 0', `${inner} 0`, `${inner} ${strip}`, `100% ${strip}`, '100% 100%', '0 100%']
      : side === 'right'
        ? ['0 0', '100% 0', '100% 100%', `${inner} 100%`, `${inner} ${strip}`, `0 ${strip}`]
        : ['0 0', '100% 0', `100% ${strip}`, `${inner} ${strip}`, `${inner} 100%`, '0 100%']
  return `polygon(${points.join(', ')})`
}

export function mountPreviewBarHost(options: PreviewBarHostOptions): PreviewBarHost {
  const basePath = options.basePath ?? PREVIEW_BAR_ROUTE
  const position: PreviewBarPosition = options.position === 'top' ? 'top' : 'bottom'
  const BAR_HEIGHT = barHeight(position)
  let path = options.path ?? currentPath()
  let destroyed = false
  /** An overlay (menu, tooltip, dialog) is open: the whole frame shows and takes clicks. */
  let overlayOpen = false
  /** The document pane's width, or 0 while it's closed. */
  let panelWidth = 0
  /** Which edge the pane sits on. */
  let panelSide: 'left' | 'right' = 'left'

  const wrapper = document.createElement('div')
  wrapper.setAttribute('popover', 'manual')
  wrapper.dataset.sanityPreviewBar = ''
  // Overrides the UA popover box (centred, bordered, padded, opaque). `z-index` only matters in
  // browsers without the Popover API, where the wrapper is not in the top layer.
  Object.assign(wrapper.style, {
    position: 'fixed',
    inset: position === 'top' ? '0 0 auto 0' : 'auto 0 0 0',
    zIndex: '2147483000',
    boxSizing: 'border-box',
    width: '100%',
    height: `calc${BAR_HEIGHT}`,
    margin: '0',
    padding: '0',
    border: '0',
    overflow: 'hidden',
    background: 'transparent',
  } satisfies Partial<CSSStyleDeclaration>)

  const iframe = document.createElement('iframe')
  iframe.src = position === 'top' ? `${basePath}?${PREVIEW_BAR_POSITION_PARAM}=top` : basePath
  iframe.title = 'Sanity preview bar'
  iframe.allow = 'clipboard-write'
  iframe.setAttribute(
    'sandbox',
    'allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox allow-top-navigation',
  )
  Object.assign(iframe.style, {
    position: 'absolute',
    [position]: `env(safe-area-inset-${position}, 0px)`,
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

  // Reserve room so the bar never covers the footer (or, at the top, the start of the page).
  const root = document.documentElement
  root.style.setProperty(`padding-${position}`, `${PREVIEW_BAR_HEIGHT}px`)

  /** Clipping for the current overlay and pane state. */
  function layout() {
    const panel = panelWidth > 0
    wrapper.style.height = panel ? '100dvh' : `calc${BAR_HEIGHT}`
    wrapper.style.overflow = overlayOpen ? 'visible' : 'hidden'
    wrapper.style.clipPath =
      panel && !overlayOpen ? panelClipPath(panelSide, position, panelWidth, BAR_HEIGHT) : ''
    root.style.removeProperty('padding-left')
    root.style.removeProperty('padding-right')
    if (panel && window.innerWidth - panelWidth >= PREVIEW_PANEL_MIN_PAGE_WIDTH) {
      root.style.setProperty(`padding-${panelSide}`, `${panelWidth}px`)
    }
  }

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
        overlayOpen = event.data.open
        layout()
        break
      case 'sanity-preview-bar:panel':
        panelWidth = event.data.open ? Math.min(event.data.width, window.innerWidth) : 0
        panelSide = event.data.side
        layout()
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

  // ⌘K / Ctrl+K on the page opens the bar's search, like the Studio's shortcut; `E` (not while
  // typing) toggles the document pane, when the bar has one.
  function onKeyDown(event: KeyboardEvent) {
    const key = event.key.toLowerCase()
    if ((event.metaKey || event.ctrlKey) && key === 'k') {
      event.preventDefault()
      post({type: 'sanity-preview-bar:search'})
      return
    }
    if (key !== 'e' || event.metaKey || event.ctrlKey || event.altKey) return
    if (event.repeat || event.isComposing || event.defaultPrevented || isEditable(event.target))
      return
    post({type: 'sanity-preview-bar:pane'})
  }

  function onResize() {
    if (panelWidth > 0) layout()
  }

  window.addEventListener('message', onMessage)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('resize', onResize)

  function destroy() {
    if (destroyed) return
    destroyed = true
    window.removeEventListener('message', onMessage)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('resize', onResize)
    root.style.removeProperty(`padding-${position}`)
    root.style.removeProperty('padding-left')
    root.style.removeProperty('padding-right')
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

export type PreviewBarFrameOptions = {
  /** Reruns the page's data in place, no reload (SvelteKit `refreshAll`, Next.js `router.refresh`). */
  refresh: () => unknown
  /** Client-side navigation to a root-relative href (SvelteKit `goto`, Next.js `router.push`). */
  navigate: (href: string) => unknown
  /** The current path and query. Default `location.pathname + location.search`. */
  path?: string
}

/**
 * The site's side when the Studio's Visual Editor tool frames it (`isPreviewBarFrame()`): no bar
 * here (the tool shows it above the frame), just the tool's messages. The page reports its path
 * on load and after every navigation (`setPath`), reruns its data when the bar switches
 * perspective, and navigates when a search result is picked. Only the parent window on this
 * origin is listened to.
 */
export function mountPreviewBarFrame(options: PreviewBarFrameOptions): PreviewBarHost {
  let path = options.path ?? currentPath()
  let destroyed = false

  function post(message: PreviewBarMessage) {
    window.parent.postMessage(message, window.location.origin)
  }

  function onMessage(event: MessageEvent) {
    if (event.origin !== window.location.origin || event.source !== window.parent) return
    if (!isPreviewBarMessage(event.data)) return
    switch (event.data.type) {
      case 'sanity-preview-bar:ready':
        post({type: 'sanity-preview-bar:frame-path', path})
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

  window.addEventListener('message', onMessage)
  post({type: 'sanity-preview-bar:frame-path', path})

  return {
    setPath(next) {
      path = next
      if (!destroyed) post({type: 'sanity-preview-bar:frame-path', path})
    },
    destroy() {
      destroyed = true
      window.removeEventListener('message', onMessage)
    },
  }
}

export {isPreviewBarFrame} from '../core/protocol'
