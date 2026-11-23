// Loaded only by the bar's route, inside the host's iframe. The stylesheet and styled-components'
// <style> tags land in the iframe's document, never in the site's.
import '@sanity/ui/styles.css'
import EditIcon from '@sanity/icons/Edit'
import EllipsisHorizontalIcon from '@sanity/icons/EllipsisHorizontal'
import EyeClosedIcon from '@sanity/icons/EyeClosed'
import LeaveIcon from '@sanity/icons/Leave'
import SearchIcon from '@sanity/icons/Search'
import {Button, Card, Flex, Text, ThemeProvider, usePrefersDark} from '@sanity/ui'
import {Menu, MenuButton} from '@sanity/ui/menu'
import {buildTheme} from '@sanity/ui/theme'
import {StrictMode, useCallback, useEffect, useRef, useState} from 'react'
import {AnimatePresence} from 'motion/react'
import {createRoot} from 'react-dom/client'
import type {PreviewBarData} from '../core/data'
import {
  parsePerspective,
  perspectiveTone,
  serializePerspective,
  type PreviewPerspective,
} from '../core/perspective'
import {isPreviewBarMessage, type PaneSide, type PreviewBarMessage} from '../core/protocol'
import {BarDataContext, useBarData} from './context'
import {injectStudioDocumentCss, keepStyledComponentsLast} from './document-css'
import {Logo} from './logo'
import {PerspectiveMenu, studioPerspectiveParams, usePerspectiveSwitch} from './PerspectiveMenu'
import {SearchDialog} from './SearchDialog'
import {StudioMenuItem} from './StudioMenuItem'
import {StudioTooltip} from './StudioTooltip'
import {WorkspaceMenu} from './WorkspaceMenu'
import {fetchCurrentUser, openStudioSignIn, useStudioSession} from './session'
import {useDocumentPaneState} from './pane-state'
import {ShareMenu, type StudioSharingClient} from './ShareMenu'
import {type StudioConfigLoader, StudioLayer} from './StudioLayer'

export type {StudioConfigLoader}

/** Client-side options for `mountPreviewBar`. */
export type PreviewBarOptions = {
  /**
   * Loads the project's Studio config. With it, signed-in editors get the Studio layer (the
   * Studio's own search, and the document pane with `documentPane`); without it, the bar works as
   * before.
   */
  studioConfig?: StudioConfigLoader
  /**
   * An **Edit** button that opens the page's document in the Studio's own document editor, in a
   * pane on the right of the page (the pane Presentation shows). Needs `studioConfig` and the
   * server's `pageDocuments`; editors only. Default `false`.
   */
  documentPane?: boolean | DocumentPaneOptions
}

/** `documentPane` settings. */
export type DocumentPaneOptions = {
  /**
   * `false` hides the "All fields" tab of field groups in the pane (Sanity's `ALL_FIELDS_GROUP`
   * with `hidden: true`, added to the bar's copy of your config only). Default `true`.
   */
  allFieldsGroup?: boolean
  /** Which side of the page the pane opens on. Default `'left'`. */
  side?: PaneSide
}

export type {PreviewBarData}

const theme = buildTheme()

// Sanity UI's space scale has no 10px step: 10px inline padding, 20px from 1024px up. Breakpoints
// follow the bar's own width (`.preview-bar-wide`), not the viewport's: beside the document pane
// the bar is only as wide as the page.
const CARD_CSS = `
.preview-bar-card { padding-inline: 10px; }
/* HomeButton's StyledCard: radius 2 (3px), no underline, focus ring only for keyboard focus. */
/* The active search result (keyboard or pointer), like the Studio's CommandList active item. */
.preview-search-row[data-active] { background-color: var(--card-muted-bg-color); }
.preview-bar-home { display: flex; border-radius: 3px; outline: none; text-decoration: none; }
.preview-bar-home:focus-visible { box-shadow: 0 0 0 1px var(--card-bg-color), 0 0 0 3px var(--card-focus-ring-color); }
.preview-bar-wide { padding-inline: 20px; }
/* Brand, perspective switcher, actions. Below 1024px (tablet and phone) a row with the switcher
   after the brand; from 1024px a 1fr / auto / 1fr grid, so the switcher sits on the bar's centre
   whatever the side groups measure. 4px gaps, the Studio navbar's spacing. */
.preview-bar-layout { display: flex; align-items: center; gap: 4px; }
.preview-bar-start { display: flex; align-items: center; gap: 4px; flex: none; }
.preview-bar-center { display: flex; align-items: center; flex: 1; min-width: 0; }

.preview-bar-end { display: flex; align-items: center; gap: 4px; flex: none; }
.preview-bar-wide .preview-bar-layout { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); }
.preview-bar-wide .preview-bar-center { justify-self: center; }
.preview-bar-wide .preview-bar-end { justify-self: end; }
/* The Studio's global scrollbar (GlobalStyleSheet): 12px, a 4px transparent border around a
   border-colour thumb that darkens on hover, transparent track. */
::-webkit-scrollbar { width: 12px; height: 12px; }
::-webkit-scrollbar-corner { background-color: transparent; }
::-webkit-scrollbar-thumb { background-clip: content-box; background-color: var(--card-border-color); border: 4px solid transparent; }
::-webkit-scrollbar-thumb:hover { background-color: var(--card-muted-fg-color); }
::-webkit-scrollbar-track { background: transparent; }
/* The document pane's resizer: a 6px strip on its left edge; a 2px focus-colour line while it's
   hovered, dragged or focused, like the Studio's pane resizer. */
.preview-bar-pane-resizer { position: absolute; top: 0; bottom: 0; left: 0; width: 6px; cursor: ew-resize; touch-action: none; outline: none; z-index: 1000; }
.preview-bar-pane-resizer[data-side="left"] { left: auto; right: 0; }
.preview-bar-pane-resizer::after { content: ''; position: absolute; top: 0; bottom: 0; left: 0; width: 2px; background: transparent; transition: background-color 0.1s; }
.preview-bar-pane-resizer[data-side="left"]::after { left: auto; right: 0; }
.preview-bar-pane-resizer:hover::after, .preview-bar-pane-resizer[data-active]::after, .preview-bar-pane-resizer:focus-visible::after { background: var(--card-focus-ring-color, #556bfc); }
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

const OVERLAYS = '[data-ui="Dialog"], [data-ui="Popover"], [data-ui="Tooltip"]'

/**
 * The pane's own overlays are portaled to the frame's body. Dialogs cover the frame, and popovers
 * or tooltips can reach past the pane's left edge; while any of them does, the host must stop
 * clipping the frame to the pane, as it does for the bar's menus.
 */
function usePaneOverlays(open: boolean, width: number, side: PaneSide, setOverflow: SetOverflow) {
  useEffect(() => {
    if (!open) return
    let frame = 0
    function check() {
      frame = 0
      const outside = [...document.querySelectorAll<HTMLElement>(OVERLAYS)].some((element) => {
        if (element.closest('[data-preview-bar-panel]')) return false
        if (element.dataset.ui === 'Dialog') return true
        const rect = element.getBoundingClientRect()
        if (rect.width === 0) return false
        return side === 'right' ? rect.left < window.innerWidth - width - 1 : rect.right > width + 1
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
  }, [open, width, side, setOverflow])
}

function isEditable(target: EventTarget | null) {
  const element = target as HTMLElement | null
  return Boolean(
    element?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]'),
  )
}

/**
 * `E` toggles the document pane, from the bar's frame or (forwarded by the host) the page, unless
 * the editor is typing. A bare key, like GitHub's `.` and `e`, so it collides with no browser
 * shortcut.
 */
function usePaneShortcut(toggle: () => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== 'e' || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.repeat || event.isComposing || isEditable(event.target)) return
      event.preventDefault()
      toggle()
    }
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin || event.source !== window.parent) return
      if (isPreviewBarMessage(event.data) && event.data.type === 'sanity-preview-bar:pane') toggle()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('message', onMessage)
    }
  }, [toggle, enabled])
}

/** An element's width, kept current; the viewport's until it's measured. */
function useElementWidth(element: HTMLElement | null) {
  const [width, setWidth] = useState(() => window.innerWidth)
  useEffect(() => {
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry)
        setWidth(Math.round(entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])
  return width
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
  // The bar's own width (it narrows beside the document pane). Theme media is [360, 600, …]:
  // button labels from 600px up, icon-only below so the bar fits; the centred grid from 1024px.
  const [barElement, setBarElement] = useState<HTMLElement | null>(null)
  const barWidth = useElementWidth(barElement)
  const showLabels = barWidth >= 600
  // Local state: a switch updates the bar in place while the host refreshes the page around it.
  const [perspective, setPerspective] = useState<PreviewPerspective>(() =>
    parsePerspective(data.perspective),
  )
  const refreshHost = useHostRefresh()
  const switchPerspective = usePerspectiveSwitch({
    basePath: data.basePath,
    releases: data.releases,
    perspective,
    onChange: setPerspective,
    onRefresh: refreshHost,
  })
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
  const [signingIn, setSigningIn] = useState(false)
  const signedIn = session.status === 'signed-in'
  // Signed-in editors search with the Studio's own popover once the Studio layer is ready;
  // everyone else keeps the bar's search.
  const [studioReady, setStudioReady] = useState(false)
  // The editor's Studio client, for the share menu's "Share this preview" switch.
  const [studioSharing, setStudioSharing] = useState<StudioSharingClient | null>(null)
  const studioSearch = signedIn && studioReady && Boolean(data.search)
  const searchTypes = (data.search ?? []).flatMap(({kind}) => (kind === 'route' ? [] : [kind]))

  // The page's document (from the Studio's Presentation route map), for the document pane.
  const [pageDocument, setPageDocument] = useState<{_id: string; _type: string} | null>(null)
  useEffect(() => {
    if (!options.documentPane || !signedIn || !studioReady || !data.pageDocuments || path === null)
      return
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
  }, [options.documentPane, signedIn, studioReady, data.pageDocuments, data.basePath, path])

  // The document pane (`pane-state.ts`): it follows the page and survives reloads for this tab.
  const panelEnabled = Boolean(options.documentPane && options.studioConfig)
  const paneOptions: DocumentPaneOptions =
    typeof options.documentPane === 'object' ? options.documentPane : {}
  const pane = useDocumentPaneState({
    enabled: panelEnabled && signedIn,
    pageDocument,
    setOverflow,
  })
  const paneSide: PaneSide = paneOptions.side === 'right' ? 'right' : 'left'
  const barBesidePanel = pane.open && pane.beside
  useEffect(() => {
    postToHost({
      type: 'sanity-preview-bar:panel',
      open: pane.open,
      width: pane.open ? pane.width : 0,
      side: paneSide,
    })
  }, [pane.open, pane.width, paneSide])
  usePaneOverlays(pane.open, pane.width, paneSide, setOverflow)
  usePaneShortcut(pane.toggle, panelEnabled && signedIn && (pane.open || pane.canOpen))
  function openPanel() {
    // The button unmounts under the pointer, with no mouseleave to release its tooltip overflow.
    setOverflow('edit-button', false)
    pane.openPane()
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
        ref={setBarElement}
        className={barWidth >= 1024 ? 'preview-bar-card preview-bar-wide' : 'preview-bar-card'}
        // Beside the open pane the bar narrows to the page's width, on the pane's other side.
        style={
          barBesidePanel
            ? {
                width: `calc(100% - ${pane.width}px)`,
                alignSelf: paneSide === 'right' ? 'flex-start' : 'flex-end',
              }
            : {width: '100%'}
        }
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
              onSelect={switchPerspective}
            />
          </div>
          {/* Shopify's preview bar: copy link, the "…" menu, then the primary pill. */}
          <div className="preview-bar-end">
            {data.links && (
              <ShareMenu
                sharing={data.sharing}
                path={path ?? '/'}
                perspectiveKey={serializePerspective(perspective)}
                studio={signedIn ? studioSharing : null}
                setOverflow={setOverflow}
              />
            )}
            <MoreMenu setOverflow={setOverflow} />
            {/* Hidden while the pane is open: the pane's own × closes it. */}
            {panelEnabled && signedIn && pane.canOpen && !pane.open && (
              <span style={{display: 'flex'}} {...overflowWhileHovered('edit-button', setOverflow)}>
                <StudioTooltip content="Edit this page" hotkeys={['E']}>
                  {/* The bar's primary pill (white), in place of Visual Editor. */}
                  <Button
                    mode="default"
                    padding={2}
                    icon={EditIcon}
                    text={showLabels ? 'Edit' : undefined}
                    aria-label="Edit this page"
                    onClick={openPanel}
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
      {/* Zero-size, so nothing the Studio renders in place (its loading block) moves the bar; the
          pane and popovers are fixed or portaled. */}
      {signedIn && options.studioConfig && (
        <div style={{position: 'absolute', width: 0, height: 0}}>
          <StudioLayer
            load={options.studioConfig}
            studioPath={data.studioPath}
            perspective={studioPerspective}
            onPerspectiveChange={switchPerspective}
            onSharingClient={setStudioSharing}
            allFieldsGroup={paneOptions.allFieldsGroup !== false}
            panel={
              panelEnabled
                ? {
                    stack: pane.open ? pane.stack : [],
                    onChange: pane.change,
                    width: pane.width,
                    fullHeight: pane.beside,
                    side: paneSide,
                    resize: pane.resize,
                  }
                : undefined
            }
            onReady={() => setStudioReady(true)}
            search={{
              open: studioSearch && searchOpen,
              types: searchTypes,
              onClose: closeStudioSearch,
              onSelect: openStudioSearchResult,
            }}
          />
        </div>
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

/** Where the Studio keeps its appearance setting (`light`, `dark` or `system`), on this origin. */
const STUDIO_SCHEME_KEY = 'sanityStudio:ui:colorScheme'

function readStudioScheme(): 'light' | 'dark' | 'system' {
  try {
    const value = window.localStorage.getItem(STUDIO_SCHEME_KEY)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

/**
 * The Studio's own appearance setting, so the bar matches the Studio (and the document pane, which
 * reads the same setting) when an editor picked light or dark there. Follows changes made in a
 * Studio tab through `storage` events; "system" follows the OS.
 */
function useStudioScheme() {
  const prefersDark = usePrefersDark()
  const [setting, setSetting] = useState(readStudioScheme)
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key === STUDIO_SCHEME_KEY || event.key === null) setSetting(readStudioScheme())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  return setting === 'system' ? (prefersDark ? 'dark' : 'light') : setting
}

function App({data, options}: {data: PreviewBarData; options: PreviewBarOptions}) {
  const scheme = useStudioScheme()
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
  const stopReordering = keepStyledComponentsLast(element.ownerDocument)
  const root = createRoot(element)
  root.render(
    <StrictMode>
      <App data={data} options={options} />
    </StrictMode>,
  )
  return () => {
    root.unmount()
    stopReordering()
  }
}
