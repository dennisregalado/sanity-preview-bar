// Loaded only by the bar's route, inside the host's iframe. The stylesheet and styled-components'
// <style> tags land in the iframe's document, never in the site's.
import '@sanity/ui/styles.css'
import AddIcon from '@sanity/icons/Add'
import EditIcon from '@sanity/icons/Edit'
import EllipsisHorizontalIcon from '@sanity/icons/EllipsisHorizontal'
import EyeClosedIcon from '@sanity/icons/EyeClosed'
import LeaveIcon from '@sanity/icons/Leave'
import SearchIcon from '@sanity/icons/Search'
import {Button, Card, Flex, Text, ThemeProvider, usePrefersDark} from '@sanity/ui'
import {Menu, MenuButton} from '@sanity/ui/menu'
import {buildTheme} from '@sanity/ui/theme'
import {StrictMode, useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react'
import {AnimatePresence} from 'motion/react'
import {createRoot} from 'react-dom/client'
import type {PreviewBarData} from '../core/data'
import {
  parsePerspective,
  perspectiveTone,
  selectionOf,
  serializePerspective,
  type PreviewPerspective,
} from '../core/perspective'
import {
  isInspectorShortcut,
  isPreviewBarMessage,
  type PaneSide,
  type PreviewBarMessage,
  type PreviewBarSelection,
  readPreviewBarContext,
  readPreviewBarPosition,
} from '../core/protocol'
import {BarDataContext, BarPositionContext, useBarData, useBarPlacement} from './context'
import {injectStudioDocumentCss, keepStyledComponentsLast} from './document-css'
import {Logo} from './logo'
import {PerspectiveMenu, studioPerspectiveParams, usePerspectiveSwitch} from './PerspectiveMenu'
import {SearchDialog} from './SearchDialog'
import {StudioMenuItem} from './StudioMenuItem'
import {StudioTooltip} from './StudioTooltip'
import {WorkspaceMenu} from './WorkspaceMenu'
import {createRefreshWaiter} from './refresh'
import {fetchCurrentUser, openStudioSignIn, useStudioSession} from './session'
import {publishedId, store, useDocumentPaneState} from './pane-state'

/** The Visual Editor's inspector (click-to-edit) is on for this tab. */
const INSPECTOR_KEY = 'sanity-preview-bar:inspector'

function readInspector() {
  try {
    return window.sessionStorage.getItem(INSPECTOR_KEY) === '1'
  } catch {
    return false
  }
}
import {InspectorButton} from './InspectorButton'
import {NativePagePreview, PagePicker, pageFallbackTitle} from './PagePicker'
import {ViewportButton} from './ViewportButton'
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
  /**
   * The Studio has the Visual Editor tool (`visualEditorTool()` from `sanity-preview-bar/studio`):
   * **Edit** opens this page there, in the same tab (`true` for the default tool name, or
   * `{tool}` for another). With `documentPane` as well, `E` still opens the pane on the site.
   */
  visualEditor?: boolean | {tool?: string}
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

// Padding is the Studio navbar's (`padding={3}`, 12px on every side). Breakpoints
// follow the bar's own width (`.preview-bar-wide`), not the viewport's: beside the document pane
// the bar is only as wide as the page.
const CARD_CSS = `
/* HomeButton's StyledCard: radius 2 (3px), no underline, focus ring only for keyboard focus. */
/* The active search result (keyboard or pointer), like the Studio's CommandList active item. */
.preview-search-row[data-active] { background-color: var(--card-muted-bg-color); }
/* The Visual Editor's search layer lets clicks through, except on the search's backdrop and card. */
.preview-bar-search-layer * { pointer-events: auto; }
.preview-bar-home { display: flex; border-radius: 3px; outline: none; text-decoration: none; }
.preview-bar-home:focus-visible { box-shadow: 0 0 0 1px var(--card-bg-color), 0 0 0 3px var(--card-focus-ring-color); }
/* Brand, perspective switcher, actions. Below 1024px (tablet and phone), or with the document pane
   open, a row with the switcher after the brand; otherwise a 1fr / auto / 1fr grid, so the
   switcher sits on the bar's centre whatever the side groups measure. 4px gaps, the Studio
   navbar's spacing. */
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

/**
 * How the bar reaches its host. Framed (on the site, by `sanity-preview-bar/host`), that's the
 * parent window on this origin. Rendered natively in the Studio's Visual Editor tool, it's the
 * tool itself (`mountPreviewBar`'s `host` option). Same messages either way.
 */
export type BarHost = {
  post: (message: PreviewBarMessage) => void
  subscribe: (listener: (message: PreviewBarMessage) => void) => () => void
  /** The page's path and query when the bar mounts, when the host already knows it. */
  initialPath: () => string | null
}

const frameHost: BarHost = {
  post: (message) => window.parent.postMessage(message, window.location.origin),
  subscribe(listener) {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin || event.source !== window.parent) return
      if (isPreviewBarMessage(event.data)) listener(event.data)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  },
  initialPath() {
    try {
      const {pathname, search} = window.parent.location
      return `${pathname}${search}`
    } catch {
      return null
    }
  },
}

/** One bar per document: set by `mountPreviewBar`. */
let host: BarHost = frameHost

function postToHost(message: PreviewBarMessage) {
  host.post(message)
}

/** The storefront page's path and query, seeded from the parent (same origin) and kept current by the host. */
function readParentPath() {
  return host.initialPath()
}

/**
 * The storefront path. Read straight from the same-origin parent on mount, because the `ready` /
 * `path` handshake can lose its first round while the frame loads; the host's `path` messages then
 * keep it current across client-side navigation.
 */
function useHostPath() {
  const [path, setPath] = useState<string | null>(readParentPath)

  useEffect(() => {
    function onMessage(message: PreviewBarMessage) {
      if (message.type === 'sanity-preview-bar:path') {
        setPath(message.path)
      }
    }
    const unsubscribe = host.subscribe(onMessage)
    postToHost({type: 'sanity-preview-bar:ready'})
    return () => unsubscribe()
  }, [])

  return path
}

/**
 * Asks the host to rerun the storefront's queries after a perspective change and resolves once it
 * reports `refreshed`, so the switcher can keep its spinner until the page shows the new content.
 * Resolves anyway after `HOST_REFRESH_TIMEOUT_MS`: a page mid-load, a 404 or a page without the
 * host never answers.
 */
function useHostRefresh() {
  const waiter = useMemo(
    () => createRefreshWaiter(() => postToHost({type: 'sanity-preview-bar:refresh'})),
    [],
  )

  useEffect(() => {
    function onMessage(message: PreviewBarMessage) {
      if (message.type === 'sanity-preview-bar:refreshed') waiter.settle()
    }
    const unsubscribe = host.subscribe(onMessage)
    return () => {
      unsubscribe()
      waiter.settle()
    }
  }, [waiter])

  return waiter.request
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
    function onMessage(message: PreviewBarMessage) {
      if (message.type === 'sanity-preview-bar:pane') toggle()
    }
    window.addEventListener('keydown', onKeyDown)
    const unsubscribe = host.subscribe(onMessage)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      unsubscribe()
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
  const place = useBarPlacement()
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
              placement: place('top-end'),
              fallbackPlacements: [place('top-start')],
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
  newDocument,
  inTool,
  setOverflow,
}: {
  showTitle: boolean
  /** In the Visual Editor tool the logo goes back to the Studio, in the same tab. */
  inTool: boolean
  onSearch: () => void
  /** The Studio navbar's "Create new document" button (signed-in editors). */
  newDocument: {
    open: boolean
    onToggle: () => void
    ref: (element: HTMLElement | null) => void
  } | null
  setOverflow: SetOverflow
}) {
  const {brand, studioPath, search} = useBarData()
  return (
    <Flex align="center" gap={1} flex="none">
      <a
        href={studioPath}
        target={inTool ? '_top' : '_blank'}
        rel={inTool ? undefined : 'noopener'}
        aria-label={inTool ? 'Back to Sanity Studio' : 'Open Sanity Studio'}
        className="preview-bar-home"
        onClick={(event) => {
          // In the tool the Studio's router goes home (no reload); modifier clicks keep the link.
          if (!inTool || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0)
            return
          event.preventDefault()
          postToHost({type: 'sanity-preview-bar:studio-home'})
        }}
      >
        <Flex
          align="center"
          justify="center"
          style={{width: 25, height: 25, borderRadius: 3, overflow: 'hidden'}}
        >
          {brand.icon ?? (brand.logo && <Logo logo={brand.logo} />)}
        </Flex>
      </a>
      {showTitle && (
        <WorkspaceMenu
          onOpenChange={(open) => setOverflow('workspace-menu', open)}
          onHoverChange={(hovered) => setOverflow('workspace-button', hovered)}
        />
      )}
      {/* The Studio navbar's "Create new document" button, before search. */}
      {newDocument && (
        <span
          style={{display: 'flex'}}
          {...overflowWhileHovered('new-document-button', setOverflow)}
        >
          <StudioTooltip content="Create new document" disabled={newDocument.open}>
            <Button
              ref={newDocument.ref}
              mode="bleed"
              padding={2}
              icon={AddIcon}
              selected={newDocument.open}
              aria-label="Create new document"
              aria-haspopup="true"
              aria-expanded={newDocument.open}
              onClick={newDocument.onToggle}
            />
          </StudioTooltip>
        </span>
      )}
      {/* The Studio navbar's search button, with its "Search ⌘K" tooltip. */}
      {/* In the Visual Editor, search lives in the page picker in the middle of the bar. */}
      {search && !inTool && (
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
    function onMessage(message: PreviewBarMessage) {
      if (message.type === 'sanity-preview-bar:search') open()
    }
    window.addEventListener('keydown', onKeyDown)
    const unsubscribe = host.subscribe(onMessage)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      unsubscribe()
    }
  }, [open, enabled])
}

/** The Visual Editor tool's pane state, sent by the tool (`editor-state`). */
type ToolEditorState = {open: boolean; available?: boolean}

/**
 * The Visual Editor tool's pane, as the tool reports it (`editor-state`): open or closed, and
 * whether the page has a document to edit. Without `available`, the bar's own page lookup decides.
 */
function useToolEditor(enabled: boolean, initial?: ToolEditorState) {
  const [state, setState] = useState<ToolEditorState>(initial ?? {open: false})
  useEffect(() => {
    if (!enabled) return
    function onMessage(message: PreviewBarMessage) {
      if (message.type === 'sanity-preview-bar:editor-state') {
        setState({open: message.open, available: message.available})
      }
    }
    const unsubscribe = host.subscribe(onMessage)
    return () => unsubscribe()
  }, [enabled])
  return state
}

function sameSelection(a: PreviewBarSelection, b: PreviewBarSelection) {
  return (
    a.selected === b.selected && [...a.excluded].sort().join() === [...b.excluded].sort().join()
  )
}

function Bar({
  data,
  options,
  native,
  editorState,
  initialPageDocument,
}: {
  data: PreviewBarData
  options: PreviewBarOptions
  /** Rendered natively in a running Studio: its `sanity` module (`PreviewBarView`). */
  native?: unknown
  /** The tool's pane state at mount, so the bar lays out for it from its first render. */
  editorState?: ToolEditorState
  /** The page's document at mount (Visual Editor); later as `page-document` messages. */
  initialPageDocument?: {id: string; type: string} | null
}) {
  const path = useHostPath()
  const position = useContext(BarPositionContext)
  // Framed by the Studio's Visual Editor tool (`?context=tool`): the tool shows the pane and the
  // viewport; the bar sends it documents to open instead of opening its own pane.
  const [inTool] = useState(
    () => native !== undefined || readPreviewBarContext(window.location.search) === 'tool',
  )
  const visualEditorTool =
    !inTool && options.visualEditor
      ? (typeof options.visualEditor === 'object' && options.visualEditor.tool) || 'visual-editor'
      : null
  const toolEditor = useToolEditor(inTool, editorState)
  // The page's document, from the Visual Editor tool (`page-document`), for the page picker.
  const [toolPage, setToolPage] = useState<{id: string; type: string} | null>(
    initialPageDocument ?? null,
  )
  useEffect(() => {
    if (!inTool) return
    return host.subscribe((message) => {
      if (message.type === 'sanity-preview-bar:page-document') setToolPage(message.document)
    })
  }, [inTool])
  const toolEditorOpen = toolEditor.open
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
  // ⌘K only opens: while the Studio's search is open, its own ⌘K closes it, and reopening here in
  // the same keypress would undo that.
  const searchOpenRef = useRef(searchOpen)
  searchOpenRef.current = searchOpen
  const openSearchShortcut = useCallback(() => {
    if (!searchOpenRef.current) openSearch()
  }, [openSearch])
  useSearchShortcut(openSearchShortcut, Boolean(data.search))
  const editorParams = studioPerspectiveParams(perspective, data.releases)
  // Signed-in editors get Visual Editor and the Studio layer; everyone else gets Sign in.
  // Inside the Studio the editor is signed in already, so the bar doesn't check.
  const {session, refresh: refreshSession} = useStudioSession(data.projectId, {
    enabled: native === undefined,
  })
  const [signingIn, setSigningIn] = useState(false)
  const cancelSignIn = useRef<(() => void) | null>(null)
  useEffect(() => () => cancelSignIn.current?.(), [])
  // Inside the Studio (the Visual Editor) the editor is signed in and the Studio's context is
  // there from the first render, so the bar lays out its editor controls at once.
  const signedIn = native !== undefined || session.status === 'signed-in'
  // Signed-in editors search with the Studio's own popover once the Studio layer is ready;
  // everyone else keeps the bar's search.
  const [studioReady, setStudioReady] = useState(native !== undefined)
  // The editor's Studio client, for the share menu's "Share this preview" switch.
  const [studioSharing, setStudioSharing] = useState<StudioSharingClient | null>(null)
  const studioSearch = signedIn && studioReady && Boolean(data.search)
  const searchTypes = (data.search ?? []).flatMap(({kind}) => (kind === 'route' ? [] : [kind]))

  // The page's document (from the Studio's Presentation route map), for the document pane.
  const [pageDocument, setPageDocument] = useState<{_id: string; _type: string} | null>(null)
  useEffect(() => {
    if (
      !(options.documentPane || inTool) ||
      !signedIn ||
      !studioReady ||
      !data.pageDocuments ||
      path === null
    )
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
  }, [options.documentPane, inTool, signedIn, studioReady, data.pageDocuments, data.basePath, path])

  // In the tool the Studio's perspective follows the bar's, and the bar follows the Studio's
  // (the pane's chips, the navbar's menu); equal selections are dropped, so neither echoes.
  const perspectiveRef = useRef({perspective, releases: data.releases, switchPerspective})
  perspectiveRef.current = {perspective, releases: data.releases, switchPerspective}
  useEffect(() => {
    if (!inTool) return
    postToHost({
      type: 'sanity-preview-bar:perspective',
      selection: selectionOf(perspective, data.releases),
    })
  }, [inTool, perspective, data.releases])
  useEffect(() => {
    if (!inTool) return
    function onMessage(message: PreviewBarMessage) {
      if (message.type !== 'sanity-preview-bar:set-perspective') return
      const current = perspectiveRef.current
      if (sameSelection(message.selection, selectionOf(current.perspective, current.releases)))
        return
      current.switchPerspective(message.selection)
    }
    const unsubscribe = host.subscribe(onMessage)
    return () => unsubscribe()
  }, [inTool])

  // The document pane (`pane-state.ts`): it follows the page and survives reloads for this tab.
  const panelEnabled = !inTool && Boolean(options.documentPane && options.studioConfig)
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
  // The inspector (Visual Editor only): click-to-edit on the framed page, from the button, ⌘⇧I
  // here, or ⌘⇧I on the page (the tool forwards it). Remembered for the tab.
  const [inspector, setInspector] = useState(() => inTool && readInspector())
  const toggleInspector = useCallback(() => {
    setOverflow('inspector', false)
    setInspector((active) => !active)
  }, [setOverflow])
  useEffect(() => {
    if (!inTool) return
    store('sessionStorage', INSPECTOR_KEY, inspector ? '1' : null)
    postToHost({type: 'sanity-preview-bar:inspector', active: inspector})
  }, [inTool, inspector])
  useEffect(() => {
    if (!inTool) return
    function onKeyDown(event: KeyboardEvent) {
      if (!isInspectorShortcut(event)) return
      event.preventDefault()
      toggleInspector()
    }
    window.addEventListener('keydown', onKeyDown)
    const unsubscribe = host.subscribe((message) => {
      if (message.type === 'sanity-preview-bar:toggle-inspector') toggleInspector()
    })
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      unsubscribe()
    }
  }, [inTool, toggleInspector])
  // "Create new document": the Studio's popover, then the new document in the pane.
  const [newDocumentOpen, setNewDocumentOpen] = useState(false)
  const [newDocumentAnchor, setNewDocumentAnchor] = useState<HTMLElement | null>(null)
  function toggleNewDocument() {
    setOverflow('new-document-button', false)
    setNewDocumentOpen((open) => !open)
  }
  useEffect(() => {
    setOverflow('new-document', newDocumentOpen)
  }, [newDocumentOpen, setOverflow])
  function createDocument(option: {
    templateId: string
    schemaType: string
    parameters?: Record<string, unknown>
  }) {
    setNewDocumentOpen(false)
    if (inTool) {
      postToHost({
        type: 'sanity-preview-bar:open-document',
        document: {
          id: crypto.randomUUID(),
          type: option.schemaType,
          template: option.templateId,
          templateParameters: option.parameters,
        },
      })
      return
    }
    if (!panelEnabled) {
      const params = `template=${encodeURIComponent(option.templateId)};type=${encodeURIComponent(option.schemaType)}`
      window.open(`${data.studioPath}/intent/create/${params}`, '_blank', 'noopener')
      return
    }
    pane.openDocument({
      id: crypto.randomUUID(),
      type: option.schemaType,
      params: {},
      template: option.templateId,
      templateParameters: option.parameters,
    })
  }

  function openPanel() {
    // The button unmounts under the pointer, with no mouseleave to release its tooltip overflow.
    setOverflow('edit-button', false)
    if (inTool) {
      // The tool knows the page's document when it says one is available.
      if (toolEditor.available !== undefined) {
        postToHost({type: 'sanity-preview-bar:open-editor'})
        return
      }
      if (!pageDocument) return
      postToHost({
        type: 'sanity-preview-bar:open-document',
        document: {id: publishedId(pageDocument._id), type: pageDocument._type},
      })
      return
    }
    pane.openPane()
  }
  // The primary Edit button: the tool's pane, the site's pane, or a link to the tool.
  const editAction: 'tool-pane' | 'site-pane' | 'tool-link' | null = !signedIn
    ? null
    : inTool
      ? (toolEditor.available ?? Boolean(pageDocument)) && !toolEditorOpen
        ? 'tool-pane'
        : null
      : visualEditorTool
        ? 'tool-link'
        : panelEnabled && pane.canOpen && !pane.open
          ? 'site-pane'
          : null

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
    if (inTool) {
      // No page for it: edit it in the tool's pane instead.
      postToHost({
        type: 'sanity-preview-bar:open-document',
        document: {id: publishedId(item._id), type: item._type},
      })
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
    cancelSignIn.current?.()
    cancelSignIn.current = openStudioSignIn(
      data.studioPath,
      () => fetchCurrentUser(projectId).then(Boolean),
      () => {
        cancelSignIn.current = null
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
        // The bar's edge of the frame (the host's `position`).
        justifyContent: position === 'top' ? 'flex-start' : 'flex-end',
        width: '100%',
        height: '100%',
      }}
    >
      <Card
        // Tinted like the Studio navbar for the current perspective (green for published).
        tone={perspectiveTone(perspective, data.releases)}
        as="nav"
        aria-label="Sanity preview"
        // The Studio navbar's `RootCard padding={3}`: the same height and the same 12px sides.
        padding={3}
        // Only the edge facing the page: the bar spans the viewport, so other borders read as a box.
        borderTop={position === 'bottom'}
        borderBottom={position === 'top'}
        ref={setBarElement}
        // The switcher centres on wide bars; with a document pane open (on the site or in the
        // Visual Editor) it sits after the brand.
        className={
          (
            inTool
              ? // The Visual Editor keeps its context (switcher, page) centred whenever it fits.
                barWidth >= 760
              : barWidth >= 1024 && !pane.open
          )
            ? 'preview-bar-card preview-bar-wide'
            : 'preview-bar-card'
        }
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
            <Brand
              inTool={inTool}
              showTitle={showLabels}
              onSearch={openSearch}
              newDocument={
                signedIn && studioReady
                  ? {open: newDocumentOpen, onToggle: toggleNewDocument, ref: setNewDocumentAnchor}
                  : null
              }
              setOverflow={setOverflow}
            />
          </div>
          <div className="preview-bar-center">
            {/* The Visual Editor's middle is the context, as in Shopify's theme editor: which
                version (perspective) and which page. */}
            <div style={{display: 'flex', alignItems: 'center', gap: 4, minWidth: 0}}>
              <PerspectiveMenu
                releases={data.releases}
                releasesError={data.releasesError}
                perspective={perspective}
                onOpenChange={(open) => setOverflow('perspective', open)}
                onSelect={switchPerspective}
              />
              {inTool && data.search && (
                <PagePicker
                  preview={
                    native !== undefined && toolPage ? (
                      <NativePagePreview
                        sanity={native}
                        document={toolPage}
                        fallback={pageFallbackTitle(path)}
                      />
                    ) : null
                  }
                  path={path}
                  onOpen={openSearch}
                  onHoverChange={(hovered) => setOverflow('page-picker', hovered)}
                />
              )}
            </div>
          </div>
          {/* Shopify's preview bar: copy link, the "…" menu, then the primary pill. */}
          <div className="preview-bar-end">
            {inTool && (
              <ViewportButton
                onChange={(mode) => postToHost({type: 'sanity-preview-bar:viewport', mode})}
                onOpenChange={(open) => setOverflow('viewport-menu', open)}
                onHoverChange={(hovered) => setOverflow('viewport', hovered)}
              />
            )}
            {inTool && (
              <InspectorButton
                active={inspector}
                onToggle={toggleInspector}
                onHoverChange={(hovered) => setOverflow('inspector', hovered)}
              />
            )}
            {data.links && (
              <ShareMenu
                sharing={data.sharing}
                path={path ?? '/'}
                perspectiveKey={serializePerspective(perspective)}
                studio={signedIn ? studioSharing : null}
                toolPath={
                  // Inside the tool, its own path; on the site, the tool `Edit` opens.
                  native !== undefined
                    ? window.location.pathname
                    : `${data.studioPath.replace(/\/$/, '')}/${visualEditorTool ?? 'visual-editor'}`
                }
                setOverflow={setOverflow}
              />
            )}
            {inTool ? (
              // In the Visual Editor: back to this page on the site, where its own bar (Hide bar,
              // Exit preview) takes over. A link, so a modifier click opens a new tab.
              <span style={{display: 'flex'}} {...overflowWhileHovered('exit-tool', setOverflow)}>
                <StudioTooltip content="Exit Visual Editor">
                  <Button
                    as="a"
                    mode="bleed"
                    padding={2}
                    icon={LeaveIcon}
                    aria-label="Exit Visual Editor"
                    href={path ?? '/'}
                    target="_top"
                  />
                </StudioTooltip>
              </span>
            ) : (
              <MoreMenu setOverflow={setOverflow} />
            )}
            {/* Hidden while a pane is open: the pane's own × closes it. */}
            {editAction && (
              <span style={{display: 'flex'}} {...overflowWhileHovered('edit-button', setOverflow)}>
                <StudioTooltip
                  content="Edit this page"
                  hotkeys={editAction === 'site-pane' ? ['E'] : undefined}
                >
                  {/* The bar's primary pill (white), in place of Visual Editor. */}
                  {editAction === 'tool-link' ? (
                    <Button
                      as="a"
                      mode="default"
                      padding={2}
                      icon={EditIcon}
                      text={showLabels ? 'Edit' : undefined}
                      aria-label="Edit this page"
                      href={`${data.studioPath}/${visualEditorTool}?${editorParams}`}
                      target="_top"
                    />
                  ) : (
                    <Button
                      mode="default"
                      padding={2}
                      icon={EditIcon}
                      text={showLabels ? 'Edit' : undefined}
                      aria-label="Edit this page"
                      onClick={openPanel}
                    />
                  )}
                </StudioTooltip>
              </span>
            )}
            {!signedIn && session.status === 'signed-out' ? (
              <Button
                mode="default"
                padding={2}
                text={signingIn ? 'Signing in…' : 'Sign in'}
                disabled={signingIn}
                onClick={signIn}
              />
            ) : panelEnabled || inTool || visualEditorTool ? null : (
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
      {signedIn && (options.studioConfig || native !== undefined) && (
        <div style={{position: 'absolute', width: 0, height: 0}}>
          <StudioLayer
            load={options.studioConfig}
            native={native}
            studioPath={data.studioPath}
            perspective={studioPerspective}
            onPerspectiveChange={switchPerspective}
            onSharingClient={setStudioSharing}
            newDocument={{
              open: newDocumentOpen,
              anchor: newDocumentAnchor,
              onClose: () => setNewDocumentOpen(false),
              onSelect: createDocument,
            }}
            allFieldsGroup={paneOptions.allFieldsGroup !== false}
            panel={
              panelEnabled
                ? {
                    stack: pane.open ? pane.stack : [],
                    onChange: pane.change,
                    width: pane.width,
                    fullHeight: pane.beside,
                    barPosition: position,
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
  // Set by the host in the frame's URL (`?position=top`); bottom otherwise.
  const [position] = useState(() => readPreviewBarPosition(window.location.search))
  return (
    <ThemeProvider theme={theme} scheme={scheme}>
      <BarDataContext.Provider value={data}>
        <BarPositionContext.Provider value={position}>
          <style>{CARD_CSS}</style>
          <Bar data={data} options={options} />
        </BarPositionContext.Provider>
      </BarDataContext.Provider>
    </ThemeProvider>
  )
}

/**
 * The bar rendered natively inside a running Studio, for the Visual Editor tool
 * (`sanity-preview-bar/studio`): no frame, the Studio's own context (pass its `sanity` module), and
 * the tool as the host. Always at the top, in tool mode.
 */
export function PreviewBarView({
  data,
  host: toolHost,
  sanity,
  options = {},
  editorState,
  pageDocument,
}: {
  data: PreviewBarData
  host: BarHost
  sanity: unknown
  options?: PreviewBarOptions
  /** The tool's pane state at mount; later changes come as `editor-state` messages. */
  editorState?: ToolEditorState
  /** The page's document at mount; later changes come as `page-document` messages. */
  pageDocument?: {id: string; type: string} | null
}) {
  // One bar per document: the tool's host for this one.
  host = toolHost
  const scheme = useStudioScheme()
  return (
    <ThemeProvider theme={theme} scheme={scheme}>
      <BarDataContext.Provider value={data}>
        <BarPositionContext.Provider value="top">
          <style>{CARD_CSS}</style>
          <Bar
            data={data}
            options={options}
            native={sanity}
            editorState={editorState}
            initialPageDocument={pageDocument}
          />
        </BarPositionContext.Provider>
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
