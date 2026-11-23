// Loaded only by the bar's route, inside the host's iframe. The stylesheet and styled-components'
// <style> tags land in the iframe's document, never in the site's.
import '@sanity/ui/styles.css'
import CheckmarkCircleIcon from '@sanity/icons/CheckmarkCircle'
import EditIcon from '@sanity/icons/Edit'
import ErrorOutlineIcon from '@sanity/icons/ErrorOutline'
import EllipsisHorizontalIcon from '@sanity/icons/EllipsisHorizontal'
import EyeClosedIcon from '@sanity/icons/EyeClosed'
import LeaveIcon from '@sanity/icons/Leave'
import LinkIcon from '@sanity/icons/Link'
import SearchIcon from '@sanity/icons/Search'
import {Button, Card, Flex, Text, ThemeProvider, useMediaIndex, usePrefersDark} from '@sanity/ui'
import {Menu, MenuButton} from '@sanity/ui/menu'
import {Popover} from '@sanity/ui/popover'
import {buildTheme} from '@sanity/ui/theme'
import {StrictMode, useCallback, useEffect, useRef, useState, type CSSProperties} from 'react'
import {AnimatePresence} from 'motion/react'
import {createRoot} from 'react-dom/client'
import type {PreviewBarData} from '../core/data'
import {parsePerspective, perspectiveTone, type PreviewPerspective} from '../core/perspective'
import {isPreviewBarMessage, type PreviewBarMessage} from '../core/protocol'
import {BarDataContext, useBarData} from './context'
import {injectStudioDocumentCss} from './document-css'
import {Logo} from './logo'
import {PerspectiveMenu, studioPerspectiveParams} from './PerspectiveMenu'
import {SearchDialog} from './SearchDialog'
import {StudioMenuItem} from './StudioMenuItem'
import {StudioTooltip} from './StudioTooltip'
import {WorkspaceMenu} from './WorkspaceMenu'
import {PresenceStack} from './PresenceStack'
import {fetchCurrentUser, openStudioSignIn, useStudioSession} from './session'
import type {PanelEntry} from './DocumentPanel'
import {
  type PageDocumentStatus,
  type PresenceUser,
  type StudioConfigLoader,
  StudioLayer,
} from './StudioLayer'

export type {StudioConfigLoader}

/** Client-side options for `mountPreviewBar`. */
export type PreviewBarOptions = {
  /**
   * Loads the project's Studio config. With it, signed-in editors get the Studio layer (presence
   * avatars); without it, the bar works as before.
   */
  studioConfig?: StudioConfigLoader
  /**
   * An **Edit** button that opens the page's document in the Studio's own document editor, in a
   * pane on the right of the page (the pane Presentation shows). Needs `studioConfig` and the
   * server's `pageDocuments`; editors only. Default `false`.
   */
  documentPane?: boolean
}

export type {PreviewBarData}

const theme = buildTheme()

// Sanity UI's space scale has no 10px step: 10px inline padding, 20px from 1024px up.
const CARD_CSS = `
.preview-bar-card { padding-inline: 10px; }
/* HomeButton's StyledCard: radius 2 (3px), no underline, focus ring only for keyboard focus. */
/* The active search result (keyboard or pointer), like the Studio's CommandList active item. */
.preview-search-row[data-active] { background-color: var(--card-muted-bg-color); }
.preview-bar-home { display: flex; border-radius: 3px; outline: none; text-decoration: none; }
.preview-bar-home:focus-visible { box-shadow: 0 0 0 1px var(--card-bg-color), 0 0 0 3px var(--card-focus-ring-color); }
@media (min-width: 1024px) { .preview-bar-card { padding-inline: 20px; } }
/* Brand, perspective switcher, actions. Below 1024px (tablet and phone) a row with the switcher
   after the brand; from 1024px a 1fr / auto / 1fr grid, so the switcher sits on the bar's centre
   whatever the side groups measure. 4px gaps, the Studio navbar's spacing. */
.preview-bar-layout { display: flex; align-items: center; gap: 4px; }
.preview-bar-start { display: flex; align-items: center; gap: 4px; flex: none; }
.preview-bar-center { display: flex; align-items: center; flex: 1; min-width: 0; }

.preview-bar-end { display: flex; align-items: center; gap: 4px; flex: none; }
@media (min-width: 1024px) {
  .preview-bar-layout { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); }
  .preview-bar-center { justify-self: center; }
  .preview-bar-end { justify-self: end; }
}
/* The Studio's global scrollbar (GlobalStyleSheet): 12px, a 4px transparent border around a
   border-colour thumb that darkens on hover, transparent track. */
::-webkit-scrollbar { width: 12px; height: 12px; }
::-webkit-scrollbar-corner { background-color: transparent; }
::-webkit-scrollbar-thumb { background-clip: content-box; background-color: var(--card-border-color); border: 4px solid transparent; }
::-webkit-scrollbar-thumb:hover { background-color: var(--card-muted-fg-color); }
::-webkit-scrollbar-track { background: transparent; }
@keyframes preview-bar-spin { to { transform: rotate(360deg); } }
.preview-bar-spinner { animation: preview-bar-spin 0.6s linear infinite; }
`

function postToHost(message: PreviewBarMessage) {
  window.parent.postMessage(message, window.location.origin)
}

/** The storefront page's path and query, seeded from the parent (same origin) and kept current by the host. */
function readParentPath() {
  try {
    const {pathname, search} = window.parent.location
    return `${pathname}${search}`
  } catch {
    return null
  }
}

/**
 * The storefront path. Read straight from the same-origin parent on mount, because the `ready` /
 * `path` handshake can lose its first round while the frame loads; the host's `path` messages then
 * keep it current across client-side navigation.
 */
function useHostPath() {
  const [path, setPath] = useState<string | null>(readParentPath)

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin || event.source !== window.parent) return
      if (isPreviewBarMessage(event.data) && event.data.type === 'sanity-preview-bar:path') {
        setPath(event.data.path)
      }
    }
    window.addEventListener('message', onMessage)
    postToHost({type: 'sanity-preview-bar:ready'})
    return () => window.removeEventListener('message', onMessage)
  }, [])

  return path
}

/**
 * Asks the host to rerun the storefront's queries after a perspective change and resolves once it
 * reports `refreshed`, so the switcher can keep its spinner until the page shows the new content.
 */
function useHostRefresh() {
  const pending = useRef<(() => void)[]>([])

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin || event.source !== window.parent) return
      if (isPreviewBarMessage(event.data) && event.data.type === 'sanity-preview-bar:refreshed') {
        for (const resolve of pending.current.splice(0)) resolve()
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  return useCallback(
    () =>
      new Promise<void>((resolve) => {
        pending.current.push(resolve)
        postToHost({type: 'sanity-preview-bar:refresh'})
      }),
    [],
  )
}

/**
 * Sanity UI's popovers, tooltips and menus leave with `POPOVER_MOTION_DURATION` (0.2s): a fade and
 * scale on a spring. The host keeps the frame unclipped this long after the last overlay closes so
 * that exit plays out instead of being cut off at bar height.
 */
const OVERFLOW_CLOSE_DELAY_MS = 250

/**
 * Anything drawn above the bar (menus, tooltips) needs the host to stop clipping the frame, like
 * Shopify's `PreviewBar::ShowOverflow`. Each overlay registers under its own key; the host is told
 * when the first one opens and, after `OVERFLOW_CLOSE_DELAY_MS`, when the last one has closed. An
 * overlay opening inside that window (moving from one tooltip to the next) cancels the clip.
 */
function useHostOverflow() {
  const open = useRef(new Set<string>())
  const hostOpen = useRef(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(closeTimer.current), [])
  return useCallback((key: string, visible: boolean) => {
    const overlays = open.current
    if (visible) overlays.add(key)
    else overlays.delete(key)
    clearTimeout(closeTimer.current)
    if (overlays.size > 0) {
      if (!hostOpen.current) {
        hostOpen.current = true
        postToHost({type: 'sanity-preview-bar:menu', open: true})
      }
    } else if (hostOpen.current) {
      closeTimer.current = setTimeout(() => {
        hostOpen.current = false
        postToHost({type: 'sanity-preview-bar:menu', open: false})
      }, OVERFLOW_CLOSE_DELAY_MS)
    }
  }, [])
}

type SetOverflow = ReturnType<typeof useHostOverflow>

/** Hover and focus handlers that keep the frame unclipped while a tooltip can show. */
function overflowWhileHovered(key: string, setOverflow: SetOverflow) {
  return {
    onMouseEnter: () => setOverflow(key, true),
    onMouseLeave: () => setOverflow(key, false),
    onFocus: () => setOverflow(key, true),
    onBlur: () => setOverflow(key, false),
  }
}

/** The document pane's width: Presentation-like, never wider than the viewport. */
const PANEL_WIDTH = 420

function usePanelWidth() {
  const [width, setWidth] = useState(() => Math.min(PANEL_WIDTH, window.innerWidth))
  useEffect(() => {
    const onResize = () => setWidth(Math.min(PANEL_WIDTH, window.innerWidth))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return width
}

const OVERLAYS = '[data-ui="Dialog"], [data-ui="Popover"], [data-ui="Tooltip"]'

/**
 * The pane's own overlays are portaled to the frame's body. Dialogs cover the frame, and popovers
 * or tooltips can reach past the pane's left edge; while any of them does, the host must stop
 * clipping the frame to the pane, as it does for the bar's menus.
 */
function usePaneOverlays(open: boolean, width: number, setOverflow: SetOverflow) {
  useEffect(() => {
    if (!open) return
    let frame = 0
    function check() {
      frame = 0
      const left = window.innerWidth - width
      const outside = [...document.querySelectorAll<HTMLElement>(OVERLAYS)].some((element) => {
        if (element.closest('[data-preview-bar-panel]')) return false
        if (element.dataset.ui === 'Dialog') return true
        const rect = element.getBoundingClientRect()
        return rect.width > 0 && rect.left < left - 1
      })
      setOverflow('pane-overlay', outside)
    }
    const observer = new MutationObserver(() => {
      frame ||= requestAnimationFrame(check)
    })
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'data-placement'],
    })
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      setOverflow('pane-overlay', false)
    }
  }, [open, width, setOverflow])
}

/** The share endpoint refused because Presentation's sharing was turned off after the bar loaded. */
class SharingOffError extends Error {}

/** Asks the server for a short `/p/<code>` link to `path` in the current perspective. */
async function requestShareLink(basePath: string, path: string) {
  const response = await fetch(`${basePath}/share`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({pathname: path}),
  })
  if (response.status === 409) throw new SharingOffError()
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const {url} = (await response.json()) as {url: string; expiresAt: string}
  return url
}

/**
 * Copies text that is still being fetched. A `ClipboardItem` holding a promise keeps the click's
 * user activation, which Safari otherwise loses across the request; then the Clipboard API (as
 * Presentation does), then the selection fallback for browsers that refuse both. Rejects with the
 * fetch's error when the text never arrives.
 */
async function copyText(text: Promise<string>) {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      const blob = text.then((value) => new Blob([value], {type: 'text/plain'}))
      await navigator.clipboard.write([new ClipboardItem({'text/plain': blob})])
      return true
    } catch {
      // Fall through; `await text` below rethrows a failed fetch.
    }
  }
  const value = await text
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    const field = document.createElement('textarea')
    field.value = value
    field.setAttribute('readonly', '')
    field.style.cssText = 'position:fixed;opacity:0;pointer-events:none'
    document.body.appendChild(field)
    field.select()
    const copied = document.execCommand('copy')
    field.remove()
    return copied
  }
}

/** How long Shopify-style "Link copied" confirmation stays up. */
const CONFIRMATION_MS = 3000

/**
 * Shopify's "Share preview": copies a short `/p/<code>` link that opens this page in the current
 * perspective for 2 days. The server mints it (`/preview-bar/share`) only while Presentation's
 * "Share this preview" is on; while sharing is off the button opens Presentation, where an editor
 * can turn it on.
 */
function CopyPreviewLink({
  sharing: initialSharing,
  path,
  setOverflow,
}: {
  sharing: boolean
  path: string
  setOverflow: SetOverflow
}) {
  const {basePath, studioPath} = useBarData()
  const [sharing, setSharing] = useState(initialSharing)
  const [status, setStatus] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle')
  const timer = useRef<number | undefined>(undefined)
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null)
  const label =
    status === 'failed'
      ? 'Couldn’t copy preview link'
      : sharing
        ? 'Copy preview link'
        : 'Turn on preview sharing in Presentation'

  // The confirmation floats above the bar, so the host must stop clipping the frame meanwhile.
  useEffect(() => {
    if (status !== 'copied' && status !== 'failed') return
    setOverflow('copy-confirmation', true)
    return () => setOverflow('copy-confirmation', false)
  }, [status, setOverflow])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  function openPresentation() {
    window.open(`${studioPath}/presentation?${new URLSearchParams({preview: path})}`, '_blank')
  }

  function settle(next: 'copied' | 'failed') {
    setStatus(next)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(
      () => setStatus('idle'),
      next === 'copied' ? CONFIRMATION_MS : 2000,
    )
  }

  async function handleClick() {
    if (!sharing) {
      openPresentation()
      return
    }
    if (status === 'copying') return
    setStatus('copying')
    const link = requestShareLink(basePath, path)
    // `copyText` may not await `link` on every path; keep a rejection from going unhandled.
    link.catch(() => {})
    try {
      settle((await copyText(link)) ? 'copied' : 'failed')
    } catch (err) {
      if (err instanceof SharingOffError) {
        setSharing(false)
        setStatus('idle')
        openPresentation()
        return
      }
      console.error('Preview bar: could not create a preview link', err)
      settle('failed')
    }
  }

  // Success and failure both show above the button; a tooltip alone was easy to miss.
  const failed = status === 'failed'
  const confirmation = (
    <Flex align="center" gap={2} padding={3}>
      {/* Sanity UI's `Text` colours `[data-sanity-icon]` with `--card-icon-color`. */}
      <Text
        size={1}
        style={
          {
            '--card-icon-color': failed
              ? 'var(--card-badge-critical-icon-color)'
              : 'var(--card-badge-positive-icon-color)',
          } as CSSProperties
        }
      >
        {failed ? <ErrorOutlineIcon /> : <CheckmarkCircleIcon />}
      </Text>
      <Text size={1}>
        {failed ? 'Couldn’t create a preview link. Try again.' : 'Link copied. Expires in 2 days.'}
      </Text>
    </Flex>
  )

  return (
    <span
      ref={setAnchor}
      style={{display: 'flex'}}
      {...overflowWhileHovered('copy-link', setOverflow)}
    >
      {/* The confirmation replaces the tooltip while it shows. */}
      <StudioTooltip content={label} disabled={status === 'copied' || failed}>
        <Button
          mode="bleed"
          padding={2}
          icon={LinkIcon}
          aria-label={label}
          aria-busy={status === 'copying'}
          onClick={() => void handleClick()}
        />
      </StudioTooltip>
      {/* Anchored by element: `StudioTooltip` doesn't forward the ref Popover would set. */}
      <Popover
        referenceElement={anchor}
        content={confirmation}
        open={status === 'copied' || failed}
        portal
        animate
        placement="top"
        fallbackPlacements={['top-end', 'top-start']}
        tone="default"
        zOffset={3000}
        role="status"
      />
    </span>
  )
}

/** Shopify's "…" menu: hide the bar (until the next page load) or leave preview on this page. */
function MoreMenu({setOverflow}: {setOverflow: SetOverflow}) {
  const {basePath} = useBarData()
  const [exiting, setExiting] = useState(false)
  const [open, setOpen] = useState(false)

  async function exitPreview() {
    setExiting(true)
    try {
      const response = await fetch(`${basePath}/exit`, {method: 'POST'})
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      // The host reruns the page's queries in place: preview reads as off, the storefront drops
      // drafts and Visual Editing, and the layout unmounts the bar. Same route, no reload.
      postToHost({type: 'sanity-preview-bar:refresh'})
    } catch (err) {
      console.error('Preview bar: could not exit preview', err)
      setExiting(false)
    }
  }

  // The Studio's `ContextMenuButton` tooltip ("Show more"), off while the menu is open. It wraps a
  // span, not the button: `MenuButton` clones its `button` element to attach its own ref.
  return (
    <span style={{display: 'flex'}} {...overflowWhileHovered('more-button', setOverflow)}>
      <StudioTooltip content="Show more" disabled={open}>
        <span style={{display: 'flex'}}>
          <MenuButton
            id="preview-bar-more"
            onOpen={() => {
              setOpen(true)
              setOverflow('more', true)
            }}
            onClose={() => {
              setOpen(false)
              setOverflow('more', false)
            }}
            popover={{
              animate: true,
              placement: 'top-end',
              fallbackPlacements: ['top-start'],
              portal: true,
              tone: 'default',
              zOffset: 3000,
            }}
            button={
              <Button
                mode="bleed"
                padding={2}
                icon={EllipsisHorizontalIcon}
                aria-label="More preview options"
              />
            }
            menu={
              <Menu padding={1}>
                <StudioMenuItem
                  icon={EyeClosedIcon}
                  text="Hide bar"
                  onClick={() => postToHost({type: 'sanity-preview-bar:hide'})}
                />
                <StudioMenuItem
                  icon={LeaveIcon}
                  text="Exit preview"
                  disabled={exiting}
                  onClick={() => void exitPreview()}
                />
              </Menu>
            }
          />
        </span>
      </StudioTooltip>
    </span>
  )
}

/**
 * The Studio navbar's brand: `HomeButton` (the mark in a 25px `LogoMarkContainer`, opening the
 * Studio) and, 4px on, `WorkspaceMenuButton` (the workspace title and chevron, opening the
 * workspace menu).
 */
function Brand({
  showTitle,
  onSearch,
  setOverflow,
}: {
  showTitle: boolean
  onSearch: () => void
  setOverflow: SetOverflow
}) {
  const {brand, studioPath, search} = useBarData()
  return (
    <Flex align="center" gap={1} flex="none">
      <a
        href={studioPath}
        target="_blank"
        rel="noopener"
        aria-label="Open Sanity Studio"
        className="preview-bar-home"
      >
        <Flex
          align="center"
          justify="center"
          style={{width: 25, height: 25, borderRadius: 3, overflow: 'hidden'}}
        >
          {brand.logo && <Logo logo={brand.logo} />}
        </Flex>
      </a>
      {showTitle && (
        <WorkspaceMenu
          onOpenChange={(open) => setOverflow('workspace-menu', open)}
          onHoverChange={(hovered) => setOverflow('workspace-button', hovered)}
        />
      )}
      {/* The Studio navbar's search button, with its "Search ⌘K" tooltip. */}
      {search && (
        <span style={{display: 'flex'}} {...overflowWhileHovered('search-button', setOverflow)}>
          <StudioTooltip content="Search" hotkeys={['Mod', 'K']}>
            <Button
              mode="bleed"
              padding={2}
              icon={SearchIcon}
              aria-label="Search"
              onClick={onSearch}
            />
          </StudioTooltip>
        </span>
      )}
    </Flex>
  )
}

/** ⌘K / Ctrl+K inside the bar, and the host's forwarded shortcut from the storefront page. */
function useSearchShortcut(open: () => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        open()
      }
    }
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin || event.source !== window.parent) return
      if (isPreviewBarMessage(event.data) && event.data.type === 'sanity-preview-bar:search') open()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('message', onMessage)
    }
  }, [open, enabled])
}

function Bar({data, options}: {data: PreviewBarData; options: PreviewBarOptions}) {
  const path = useHostPath()
  // Theme media is [360, 600, …]: button labels from 600px up, icon-only below so the bar fits.
  const showLabels = useMediaIndex() >= 2
  // Local state: a switch updates the bar in place while the host refreshes the page around it.
  const [perspective, setPerspective] = useState<PreviewPerspective>(() =>
    parsePerspective(data.perspective),
  )
  const refreshHost = useHostRefresh()
  const setOverflow = useHostOverflow()
  const [searchOpen, setSearchOpen] = useState(false)
  const openSearch = useCallback(() => {
    setOverflow('search', true)
    setSearchOpen(true)
  }, [setOverflow])
  // The frame stays unclipped until the dialog's exit animation finishes (`onExitComplete`).
  const closeSearch = useCallback(() => setSearchOpen(false), [])
  useSearchShortcut(openSearch, Boolean(data.search))
  const editorParams = studioPerspectiveParams(perspective, data.releases)
  // Signed-in editors get Visual Editor and the Studio layer; everyone else gets Sign in.
  const {session, refresh: refreshSession} = useStudioSession(data.projectId)
  const [presence, setPresence] = useState<PresenceUser[]>([])
  const [signingIn, setSigningIn] = useState(false)
  const signedIn = session.status === 'signed-in'
  const onlineUsers = signedIn ? withCurrentUser(session.user, presence) : []
  // Signed-in editors search with the Studio's own popover once the Studio layer is ready;
  // everyone else keeps the bar's search.
  const [studioReady, setStudioReady] = useState(false)
  const studioSearch = signedIn && studioReady && Boolean(data.search)
  const searchTypes = (data.search ?? []).flatMap(({kind}) => (kind === 'route' ? [] : [kind]))

  // The page's document (from the Studio's Presentation route map) and its live status.
  const [pageDocument, setPageDocument] = useState<{_id: string; _type: string} | null>(null)
  const [documentStatus, setDocumentStatus] = useState<PageDocumentStatus | null>(null)
  useEffect(() => {
    if (!signedIn || !studioReady || !data.pageDocuments || path === null) return
    let cancelled = false
    fetch(`${data.basePath}/document?${new URLSearchParams({path})}`)
      .then((response) => (response.ok ? response.json() : {document: null}))
      .then(({document}: {document: {_id: string; _type: string} | null}) => {
        if (!cancelled) setPageDocument(document)
      })
      .catch(() => {
        if (!cancelled) setPageDocument(null)
      })
    return () => {
      cancelled = true
    }
  }, [signedIn, studioReady, data.pageDocuments, data.basePath, path])

  // The document pane: a stack (the page's document, then references opened from it), empty
  // while closed. It follows the page: navigating elsewhere opens the new page's document.
  const panelEnabled = Boolean(options.documentPane && options.studioConfig)
  const [panelStack, setPanelStack] = useState<PanelEntry[]>([])
  const panelOpen = signedIn && panelStack.length > 0
  const panelWidth = usePanelWidth()
  const pageDocumentId = pageDocument ? publishedId(pageDocument._id) : null
  useEffect(() => {
    setPanelStack((stack) => {
      if (stack.length === 0) return stack
      if (!pageDocument || !pageDocumentId) return []
      return stack[0]?.id === pageDocumentId
        ? stack
        : [{id: pageDocumentId, type: pageDocument._type, params: {}}]
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageDocumentId])
  useEffect(() => {
    postToHost({
      type: 'sanity-preview-bar:panel',
      open: panelOpen,
      width: panelOpen ? panelWidth : 0,
    })
  }, [panelOpen, panelWidth])
  usePaneOverlays(panelOpen, panelWidth, setOverflow)
  function togglePanel() {
    if (panelStack.length > 0 || !pageDocument || !pageDocumentId) {
      setPanelStack([])
      return
    }
    setPanelStack([{id: pageDocumentId, type: pageDocument._type, params: {}}])
  }

  function closeStudioSearch() {
    setSearchOpen(false)
    // The Studio popover's exit spring is 0.4s; keep the frame unclipped until it's done.
    window.setTimeout(() => setOverflow('search', false), 450)
  }

  async function openStudioSearchResult(item: {_id: string; _type: string}) {
    const params = new URLSearchParams({type: item._type, id: item._id})
    const response = await fetch(`${data.basePath}/resolve?${params}`).catch(() => null)
    const {href} = response?.ok ? ((await response.json()) as {href?: string}) : {}
    closeStudioSearch()
    if (href) {
      postToHost({type: 'sanity-preview-bar:navigate', href})
      return
    }
    // No page in this perspective (e.g. a draft-only or archived product): open it in the Studio.
    const id = item._id.replace(/^drafts\./, '').replace(/^versions\.[^.]+\./, '')
    window.open(
      `${data.studioPath}/intent/edit/id=${encodeURIComponent(id)};type=${encodeURIComponent(item._type)}`,
      '_blank',
      'noopener',
    )
  }

  function signIn() {
    if (!data.projectId) return
    const projectId = data.projectId
    setSigningIn(true)
    openStudioSignIn(
      data.studioPath,
      () => fetchCurrentUser(projectId).then(Boolean),
      () => {
        setSigningIn(false)
        void refreshSession()
      },
    )
  }
  const studioPerspective = editorParams.toString()
  editorParams.set('preview', path ?? '/')

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        justifyContent: 'flex-end',
        width: '100%',
        height: '100%',
      }}
    >
      <Card
        // Tinted like the Studio navbar for the current perspective (green for published).
        tone={perspectiveTone(perspective, data.releases)}
        as="nav"
        aria-label="Sanity preview"
        // The Studio navbar's `RootCard padding={3}`, so both bars are the same height. Inline
        // padding comes from `.preview-bar-card` (10px, 20px from 1024px).
        padding={3}
        // Only the top edge: the bar spans the viewport, so side and bottom borders read as a box.
        borderTop
        className="preview-bar-card"
        style={{width: '100%'}}
      >
        <div className="preview-bar-layout">
          <div className="preview-bar-start">
            <Brand showTitle={showLabels} onSearch={openSearch} setOverflow={setOverflow} />
          </div>
          <div className="preview-bar-center">
            <PerspectiveMenu
              releases={data.releases}
              releasesError={data.releasesError}
              perspective={perspective}
              onOpenChange={(open) => setOverflow('perspective', open)}
              onChange={setPerspective}
              onRefresh={refreshHost}
              page={signedIn ? documentStatus : null}
            />
          </div>
          {/* Shopify's preview bar: copy link, the "…" menu, then the primary pill. */}
          <div className="preview-bar-end">
            <PresenceStack
              users={onlineUsers}
              pageEditors={signedIn ? (documentStatus?.editors ?? []) : []}
              onHoverChange={(hovered) => setOverflow('presence', hovered)}
            />
            {data.links && (
              <CopyPreviewLink
                sharing={data.sharing}
                path={path ?? '/'}
                setOverflow={setOverflow}
              />
            )}
            <MoreMenu setOverflow={setOverflow} />
            {panelEnabled && signedIn && pageDocument && (
              <span style={{display: 'flex'}} {...overflowWhileHovered('edit-button', setOverflow)}>
                <StudioTooltip
                  content={panelOpen ? 'Close editor' : 'Edit this page'}
                  disabled={showLabels}
                >
                  {/* The bar's primary pill (white), in place of Visual Editor. */}
                  <Button
                    mode="default"
                    padding={2}
                    icon={EditIcon}
                    text={showLabels ? 'Edit' : undefined}
                    aria-label={panelOpen ? 'Close editor' : 'Edit this page'}
                    aria-pressed={panelOpen}
                    onClick={togglePanel}
                  />
                </StudioTooltip>
              </span>
            )}
            {session.status === 'signed-out' ? (
              <Button
                mode="default"
                padding={2}
                text={signingIn ? 'Signing in…' : 'Sign in'}
                disabled={signingIn}
                onClick={signIn}
              />
            ) : panelEnabled ? null : (
              <Button
                as="a"
                mode="default"
                padding={2}
                text="Visual Editor"
                aria-label="Visual Editor"
                href={`${data.studioPath}/presentation?${editorParams}`}
                target="_blank"
                rel="noopener"
              />
            )}
          </div>
        </div>
      </Card>
      {signedIn && options.studioConfig && (
        <StudioLayer
          load={options.studioConfig}
          studioPath={data.studioPath}
          perspective={studioPerspective}
          panel={
            panelEnabled
              ? {stack: panelOpen ? panelStack : [], onChange: setPanelStack, width: panelWidth}
              : undefined
          }
          onPresence={setPresence}
          onReady={() => setStudioReady(true)}
          document={pageDocument}
          onDocumentStatus={setDocumentStatus}
          search={{
            open: studioSearch && searchOpen,
            types: searchTypes,
            onClose: closeStudioSearch,
            onSelect: openStudioSearchResult,
          }}
        />
      )}
      <AnimatePresence onExitComplete={() => setOverflow('search', false)}>
        {searchOpen && !studioSearch && data.search && (
          <SearchDialog
            kinds={data.search}
            onClose={closeSearch}
            onSelect={(href) => {
              closeSearch()
              postToHost({type: 'sanity-preview-bar:navigate', href})
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function App({data, options}: {data: PreviewBarData; options: PreviewBarOptions}) {
  const scheme = usePrefersDark() ? 'dark' : 'light'
  return (
    <ThemeProvider theme={theme} scheme={scheme}>
      <BarDataContext.Provider value={data}>
        <style>{CARD_CSS}</style>
        <Bar data={data} options={options} />
      </BarDataContext.Provider>
    </ThemeProvider>
  )
}

/** Renders the bar into `element` and returns its unmount function. */
export function mountPreviewBar(
  element: HTMLElement,
  data: PreviewBarData,
  options: PreviewBarOptions = {},
) {
  injectStudioDocumentCss(element.ownerDocument, {transparent: true})
  const root = createRoot(element)
  root.render(
    <StrictMode>
      <App data={data} options={options} />
    </StrictMode>,
  )
  return () => root.unmount()
}

/** A document's published ID: the pane takes it whatever version the page resolved. */
function publishedId(id: string) {
  return id.replace(/^drafts\./, '').replace(/^versions\.[^.]+\./, '')
}

/** The signed-in editor first, then everyone else the Studio reports online. */
function withCurrentUser(
  user: {id: string; name?: string; profileImage?: string},
  others: PresenceUser[],
): PresenceUser[] {
  return [
    {id: user.id, name: user.name, imageUrl: user.profileImage},
    ...others.filter((other) => other.id !== user.id),
  ]
}
