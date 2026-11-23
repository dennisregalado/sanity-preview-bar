/**
 * The Visual Editor tool: Presentation's layout with the preview bar. The bar runs along the top,
 * rendered natively in the Studio (`PreviewBarView`, with the Studio's own context), the site
 * (framed under `PREVIEW_BAR_FRAME_NAME`, at desktop width or as a 375px phone) fills the middle,
 * and the Studio's own document pane sits on the right.
 *
 * The tool is the bar's host, through the same `sanity-preview-bar:*` messages the site's host
 * uses (in process, no frame), and talks to the framed site's `mountPreviewBarFrame`: paths,
 * refreshes after a perspective switch, navigation from search. The site is framed on its origin,
 * which must be this Studio's origin (an embedded Studio). The bar's data comes from the Studio
 * (`useStudioBarData`), so it renders with the tool; the site is only asked to store the
 * perspective cookie, mint share links and resolve search results.
 *
 * The tool's own layout uses the Studio's CSS variables and plain elements.
 */
import {createPreviewSecret} from '@sanity/preview-url-secret/create-secret'
import {
  urlSearchParamPreviewPathname,
  urlSearchParamPreviewSecret,
} from '@sanity/preview-url-secret/constants'
import {type CSSProperties, useCallback, useEffect, useMemo, useRef, useState} from 'react'
import * as sanityModule from 'sanity'
import {type Tool, useClient, useCurrentUser, usePerspective, useSchema, useWorkspace} from 'sanity'
import {PresentationDocumentContext} from 'sanity/_singletons'
import {useRouter} from 'sanity/router'
import {DocumentPane, PaneLayout, PaneRouterContext, StructureToolProvider} from 'sanity/structure'
import {DocumentPanel, type PanelEntry, type StructureModule} from '../bar/DocumentPanel'
import {type BarHost, PreviewBarView} from '../bar/PreviewBar'
import {useStudioBarData} from './studio-bar-data'
import type {VisualEditorLocations} from './locations'
import {PaneResizer} from '../bar/StudioLayer'
import {
  applyEdit,
  PANEL_WIDTH,
  panelLayout,
  readNumber,
  store,
  useViewportWidth,
} from '../bar/pane-state'
import {clientDocumentFetcher, createNodeDescriber, type LabelSchema} from '../core/node-labels'
import {findPageDocumentRule, type PageDocumentRule} from '../core/page-documents'
import {
  isPreviewBarMessage,
  PREVIEW_BAR_FRAME_NAME,
  PREVIEW_BAR_HEIGHT,
  PREVIEW_BAR_ROUTE,
  type PreviewBarMessage,
  type PreviewBarSelection,
  type PreviewBarViewport,
} from '../core/protocol'

export type VisualEditorToolOptions = {
  /** The tool's name, in its URL. Default `visual-editor`. */
  name?: string
  /** Default `Visual Editor`. */
  title?: string
  previewUrl?: {
    /** The page opened without `?preview=`. Default `/`. */
    initial?: string
    /**
     * The site's preview-mode route, as in Presentation's `previewUrl.previewMode.enable`. The tool
     * creates a preview secret and opens the page through it. Default `/preview/enable`.
     */
    previewMode?: {enable: string}
  }
  /** The bar's route on the site. Default `/preview-bar`. */
  barPath?: string
  /**
   * Presentation's document resolvers, with its API (`defineDocuments`, `defineLocations`):
   * - `mainDocuments`: which document each page shows; the pane opens it as you browse. Resolved
   *   with the editor's client; without it, the site's `/preview-bar/document` route is asked.
   * - `locations`: where each document appears; every document form shows "Used on N pages", each
   *   page opening here.
   */
  resolve?: {
    mainDocuments?: PageDocumentRule[]
    locations?: VisualEditorLocations
  }
  /** @deprecated Use `resolve.mainDocuments`. */
  mainDocuments?: PageDocumentRule[]
  /** The site serves short preview links (`links` in `createPreviewBar`). Default `true`. */
  links?: boolean
  /** Document types the bar's Studio search opens filtered to. Default: all types. */
  searchTypes?: string[]
  /** The document pane's width. Default 420. */
  paneWidth?: number
  /**
   * Hide the Studio's navbar while the tool is open, so the preview bar is the only toolbar (its
   * logo goes back to the Studio). Default `true`.
   */
  hideStudioNavbar?: boolean
}

/** Device widths: Presentation's narrow viewport, and a portrait tablet. */
const VIEWPORT_WIDTHS = {tablet: 768, mobile: 375} as const

const structure = {
  DocumentPane,
  PaneLayout,
  PaneRouterContext,
  StructureToolProvider,
} as unknown as StructureModule

/** Presentation's locations banner is redundant beside the page; see the bar's `NO_LOCATIONS`. */
const NO_LOCATIONS = {options: [{}], register: () => () => {}}

function sameSelection(a: PreviewBarSelection, b: PreviewBarSelection) {
  return (
    a.selected === b.selected && [...a.excluded].sort().join() === [...b.excluded].sort().join()
  )
}

function publishedId(id: string) {
  return id.replace(/^drafts\./, '').replace(/^versions\.[^.]+\./, '')
}

// The pulse moves between the Studio's two (opaque) skeleton colours rather than fading the bone:
// the page skeleton covers the loading site, which must never show through it, so the page
// appears at once when it's removed.
const SKELETON_CSS = `
@keyframes preview-bar-skeleton {
  from { background-color: var(--card-skeleton-color-from, #eeeef1); }
  to { background-color: var(--card-skeleton-color-to, #f7f7f8); }
}
.preview-bar-skeleton { background-color: var(--card-skeleton-color-from, #eeeef1); border-radius: 3px; animation: preview-bar-skeleton 0.9s ease-in-out infinite alternate; }
`

function Bone({
  width,
  height,
  style,
}: {
  width: number | string
  height: number | string
  style?: CSSProperties
}) {
  return <div className="preview-bar-skeleton" style={{width, height, flex: 'none', ...style}} />
}

/** The page area until the framed site reports its first page: one bone over the whole page. */
function PageSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading the page"
      className="preview-bar-skeleton"
      style={{position: 'absolute', inset: 0, borderRadius: 0}}
    >
      <style>{SKELETON_CSS}</style>
    </div>
  )
}

/**
 * The pane column until the page's document is known, laid out as the Studio's document pane is
 * (measured at 420px): the 50px header with the Published and Draft chips and its icon buttons,
 * the title's breadcrumb, the type label and the title, and the footer's status, Publish and
 * actions. No fields: they differ per type.
 */
function PaneSkeleton() {
  const round = {borderRadius: 999}
  // An icon button's glyph, centred in its 25px slot.
  const icon = (right: number) => (
    <Bone width={17} height={17} style={{position: 'absolute', top: 16, right, ...round}} />
  )
  return (
    <div
      aria-busy="true"
      aria-label="Loading the document"
      style={{position: 'relative', height: '100%'}}
    >
      <style>{SKELETON_CSS}</style>
      <div
        style={{
          position: 'relative',
          height: 50,
          borderBottom: '1px solid var(--card-border-color)',
        }}
      >
        <div style={{position: 'absolute', top: 12, left: 12, display: 'flex', gap: 4}}>
          <Bone width={98} height={25} style={round} />
          <Bone width={68} height={25} style={round} />
        </div>
        {icon(16)}
        {icon(45)}
        {icon(74)}
        {icon(103)}
      </div>
      <div style={{position: 'absolute', left: 20, right: 20, top: 69}}>
        <Bone width={96} height={12} />
      </div>
      <div style={{position: 'absolute', left: 20, right: 20, top: 131}}>
        <Bone width={36} height={12} />
      </div>
      <div style={{position: 'absolute', left: 20, right: 20, top: 159}}>
        <Bone width="45%" height={21} />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: 12,
          height: 25,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <Bone width={21} height={21} style={round} />
        <Bone width={68} height={12} />
        <div style={{flex: 1}} />
        <Bone width={79} height={25} />
        <Bone width={17} height={17} style={{...round, margin: '0 4px'}} />
      </div>
    </div>
  )
}

/** The tool pane's width, apart from the site pane's (the tool's pane is full height). */
const PANE_WIDTH_KEY = 'sanity-preview-bar:visual-editor-pane-width'

export function VisualEditorTool({tool}: {tool: Tool<VisualEditorToolOptions>}) {
  const options = tool.options ?? {}
  const barPath = options.barPath ?? PREVIEW_BAR_ROUTE
  const enablePath = options.previewUrl?.previewMode?.enable ?? '/preview/enable'
  // The pane resizes from its inner edge, as the site's pane does: live while dragging, clamped so
  // the page keeps its minimum width, remembered on release.
  const windowWidth = useViewportWidth()
  const [preferredPaneWidth, setPreferredPaneWidth] = useState(
    () => readNumber(PANE_WIDTH_KEY) ?? options.paneWidth ?? PANEL_WIDTH,
  )
  const paneWidth = panelLayout(preferredPaneWidth, windowWidth).width
  const [resizing, setResizing] = useState(false)
  const paneWidthRef = useRef(paneWidth)
  paneWidthRef.current = paneWidth
  const paneResize = useMemo(
    () => ({
      start: () => setResizing(true),
      to: (width: number) => setPreferredPaneWidth(width),
      end: () => {
        setResizing(false)
        setPreferredPaneWidth(paneWidthRef.current)
        store('localStorage', PANE_WIDTH_KEY, String(paneWidthRef.current))
      },
    }),
    [],
  )
  const origin = window.location.origin

  const router = useRouter()
  const {basePath} = useWorkspace()
  const basePathRef = useRef(basePath)
  basePathRef.current = basePath
  const routerRef = useRef(router)
  routerRef.current = router
  const initialPath = useMemo(() => {
    const preview = new URLSearchParams(
      (router.state._searchParams as [string, string][] | undefined) ?? [],
    ).get('preview')
    return preview && preview.startsWith('/') && !preview.startsWith('//')
      ? preview
      : (options.previewUrl?.initial ?? '/')
    // Only the first page: the frame navigates itself after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The bar's data, from the Studio: it renders with the tool.
  const barData = useStudioBarData({
    barPath,
    links: options.links ?? true,
    searchTypes: options.searchTypes,
  })

  // Perspective, both ways: the bar's switches move the Studio's sticky params; the Studio's own
  // switches (the pane's chips, the navbar menu) go to the bar, which stores them and refreshes.
  const {selectedPerspectiveName, excludedPerspectives, perspectiveStack} = usePerspective()
  const studioSelection = useMemo<PreviewBarSelection>(
    () => ({selected: selectedPerspectiveName ?? 'drafts', excluded: excludedPerspectives ?? []}),
    [selectedPerspectiveName, excludedPerspectives],
  )
  const studioSelectionRef = useRef(studioSelection)
  studioSelectionRef.current = studioSelection

  /** Stores a perspective in the site's cookie; `false` outside preview mode (the route 404s). */
  const storePerspective = useCallback(
    async (selection: PreviewBarSelection) => {
      const response = await fetch(`${barPath}/perspective`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(selection),
      })
      return response.ok
    },
    [barPath],
  )

  // Start: store the Studio's perspective for the site. That also tells whether the editor is in
  // preview mode already (the route answers only then): if so, the site loads directly; otherwise
  // preview mode is enabled as Presentation does it, through a preview secret, and the perspective
  // is stored once the site is in.
  const client = useClient({apiVersion: '2025-02-19'})
  const currentUser = useCurrentUser()
  const [frameSrc, setFrameSrc] = useState<string | null>(null)
  const [frameError, setFrameError] = useState<string | null>(null)
  const perspectiveStored = useRef(false)
  useEffect(() => {
    let cancelled = false
    async function start() {
      const stored = await storePerspective(studioSelectionRef.current).catch(() => false)
      if (cancelled) return
      if (stored) {
        perspectiveStored.current = true
        setFrameSrc(new URL(initialPath, origin).toString())
        return
      }
      const {secret} = await createPreviewSecret(
        client,
        'sanity-preview-bar/visual-editor',
        window.location.href,
        currentUser?.id,
      )
      if (cancelled) return
      const url = new URL(enablePath, origin)
      url.searchParams.set(urlSearchParamPreviewSecret, secret)
      url.searchParams.set(urlSearchParamPreviewPathname, initialPath)
      setFrameSrc(url.toString())
    }
    start().catch((error: unknown) => {
      console.error('sanity-preview-bar: could not enable preview mode', error)
      if (!cancelled)
        setFrameError('Couldn’t open the preview. Check that you can edit this dataset.')
    })
    return () => {
      cancelled = true
    }
    // Once per tool mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const siteFrame = useRef<HTMLIFrameElement | null>(null)
  const [viewport, setViewport] = useState<PreviewBarViewport>('desktop')
  const device = viewport === 'desktop' ? null : VIEWPORT_WIDTHS[viewport]
  const [path, setPath] = useState<string | null>(null)
  const [mainDocument, setMainDocument] = useState<{id: string; type: string} | null>(null)
  const [mainDocumentLoaded, setMainDocumentLoaded] = useState(false)
  // The pane: open with the page's document by default; closing it is remembered until Edit.
  const [stack, setStack] = useState<PanelEntry[]>([])
  const [paneWanted, setPaneWanted] = useState(true)

  // The bar's host, in process: its messages go to `handleBarMessage`, the tool's to its listeners.
  const barListeners = useRef(new Set<(message: PreviewBarMessage) => void>())
  const postToBar = useCallback((message: PreviewBarMessage) => {
    for (const listener of barListeners.current) listener(message)
  }, [])
  const handleBarMessage = useRef<(message: PreviewBarMessage) => void>(() => {})
  const pathRef = useRef<string | null>(null)
  const barHost = useMemo<BarHost>(
    () => ({
      post: (message) => handleBarMessage.current(message),
      subscribe(listener) {
        barListeners.current.add(listener)
        return () => barListeners.current.delete(listener)
      },
      initialPath: () => pathRef.current,
    }),
    [],
  )

  const postToSite = useCallback(
    (message: PreviewBarMessage) => siteFrame.current?.contentWindow?.postMessage(message, origin),
    [origin],
  )

  // Click-to-edit's labels and drift check for the framed page: the Studio's schema, and documents
  // in the Studio's perspective.
  const schema = useSchema()
  const describerKey = JSON.stringify(perspectiveStack)
  const describer = useMemo(
    () =>
      createNodeDescriber(
        schema as unknown as LabelSchema,
        clientDocumentFetcher(
          client as unknown as Parameters<typeof clientDocumentFetcher>[0],
          perspectiveStack,
        ),
      ),
    // `perspectiveStack` by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schema, client, describerKey],
  )
  const describerRef = useRef(describer)
  describerRef.current = describer
  const reportFocus = useCallback(
    (focus: {id: string; path: string} | null) =>
      postToSite({type: 'sanity-preview-bar:focus', id: focus?.id ?? '', path: focus?.path ?? ''}),
    [postToSite],
  )

  // Enabled through a secret: store the perspective once the site is in, then refresh it.
  const pathKnown = path !== null
  useEffect(() => {
    if (!pathKnown || perspectiveStored.current) return
    perspectiveStored.current = true
    storePerspective(studioSelectionRef.current)
      .then((stored) => {
        if (stored) postToSite({type: 'sanity-preview-bar:refresh'})
      })
      .catch(() => {})
  }, [pathKnown, storePerspective, postToSite])

  // The page's main document: Presentation's `mainDocuments` rules resolved here with the editor's
  // client in the Studio's perspective, or the site's route without them.
  const mainDocuments = options.resolve?.mainDocuments ?? options.mainDocuments
  const stackKey = JSON.stringify(perspectiveStack)
  // The first page is known before the site loads (`?preview=`), so the pane starts with it.
  const documentPath = path ?? initialPath
  useEffect(() => {
    let cancelled = false
    let lookup: Promise<{_id: string; _type: string} | null>
    if (mainDocuments) {
      const rule = findPageDocumentRule(mainDocuments, documentPath, origin)
      lookup = rule
        ? client
            .withConfig({perspective: perspectiveStack as never})
            .fetch<{_id: string; _type: string} | null>(
              `*[${rule.filter}][0]{_id, _type}`,
              rule.params,
              {tag: 'preview-bar.main-document'},
            )
        : Promise.resolve(null)
    } else {
      lookup = fetch(`${barPath}/document?${new URLSearchParams({path: documentPath})}`, {
        credentials: 'same-origin',
      })
        .then((response) => (response.ok ? response.json() : {document: null}))
        .then(({document}: {document: {_id: string; _type: string} | null}) => document)
    }
    lookup
      .then((document) => {
        if (!cancelled)
          setMainDocument(document ? {id: publishedId(document._id), type: document._type} : null)
      })
      .catch(() => {
        if (!cancelled) setMainDocument(null)
      })
      .finally(() => {
        if (!cancelled) setMainDocumentLoaded(true)
      })
    return () => {
      cancelled = true
    }
    // `perspectiveStack` by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentPath, barPath, mainDocuments, client, stackKey])

  // The pane follows the page while it's wanted.
  useEffect(() => {
    if (!paneWanted) return
    setStack((current) => {
      if (!mainDocument) return []
      return current[0]?.id === mainDocument.id
        ? current
        : [{id: mainDocument.id, type: mainDocument.type, params: {}}]
    })
  }, [mainDocument, paneWanted])

  // The page's document for the bar's page picker, which previews it with the Studio's own
  // `Preview` (the type's icon or media, the live title).
  useEffect(() => {
    postToBar({type: 'sanity-preview-bar:page-document', document: mainDocument})
  }, [mainDocument, postToBar])

  const paneOpen = stack.length > 0
  // The pane's column shows while its document loads too, so the bar lays out for it from the start.
  const paneLoading = paneWanted && !mainDocumentLoaded
  const columnOpen = paneOpen || paneLoading
  const editorAvailable = mainDocument !== null
  useEffect(() => {
    postToBar({
      type: 'sanity-preview-bar:editor-state',
      open: columnOpen,
      available: editorAvailable,
    })
  }, [columnOpen, editorAvailable, postToBar])

  const changeStack = useCallback((next: PanelEntry[]) => {
    if (next.length === 0) setPaneWanted(false)
    setStack(next)
  }, [])

  const lastBarSelection = useRef<PreviewBarSelection | null>(null)
  useEffect(() => {
    const fromBar = lastBarSelection.current
    if (!fromBar || sameSelection(fromBar, studioSelection)) return
    postToBar({type: 'sanity-preview-bar:set-perspective', selection: studioSelection})
  }, [studioSelection, postToBar])

  const onIntent = useCallback((name: string, params: Record<string, string>) => {
    if (name === 'edit' && params.id && params.type) {
      setStack((current) => [...current, {id: params.id!, type: params.type!, params: {}}])
      return
    }
    routerRef.current.navigateIntent(name, params)
  }, [])

  // Messages from the bar (in process) and the framed site (`postMessage`).
  const latest = useRef({path, columnOpen, studioSelection, mainDocument, stack})
  latest.current = {path, columnOpen, studioSelection, mainDocument, stack}
  pathRef.current = path
  handleBarMessage.current = (message) => {
    switch (message.type) {
      case 'sanity-preview-bar:ready':
        // After the bar's other listeners subscribe (the same commit's effects run first).
        queueMicrotask(() => {
          const {path: current, columnOpen: open, mainDocument: main} = latest.current
          if (current) postToBar({type: 'sanity-preview-bar:path', path: current})
          postToBar({type: 'sanity-preview-bar:editor-state', open, available: main !== null})
          postToBar({type: 'sanity-preview-bar:page-document', document: main})
        })
        break
      case 'sanity-preview-bar:refresh':
        postToSite({type: 'sanity-preview-bar:refresh'})
        break
      case 'sanity-preview-bar:navigate':
        postToSite({type: 'sanity-preview-bar:navigate', href: message.href})
        break
      case 'sanity-preview-bar:viewport':
        setViewport(message.mode)
        break
      case 'sanity-preview-bar:open-document': {
        const {id, type, template, templateParameters} = message.document
        const entry: PanelEntry = {id, type, params: {}, template, templateParameters}
        setPaneWanted(true)
        // The page's document replaces the stack; anything else (a new document, a search result
        // without a page) goes on top, so × goes back.
        setStack((current) =>
          !template && id === latest.current.mainDocument?.id
            ? [entry]
            : current.length
              ? [...current, entry]
              : [entry],
        )
        break
      }
      case 'sanity-preview-bar:perspective': {
        lastBarSelection.current = message.selection
        if (sameSelection(message.selection, latest.current.studioSelection)) break
        const {selected, excluded} = message.selection
        routerRef.current.navigate({
          stickyParams: {
            perspective: selected === 'drafts' ? null : selected,
            excludedPerspectives: excluded.length ? excluded.join(',') : null,
          },
        } as never)
        break
      }
      case 'sanity-preview-bar:open-editor': {
        const main = latest.current.mainDocument
        if (!main) break
        setPaneWanted(true)
        setStack([{id: main.id, type: main.type, params: {}}])
        break
      }
      case 'sanity-preview-bar:studio-home':
        // The workspace's root, through the Studio's router (its default tool), no reload.
        routerRef.current.navigateUrl({path: basePathRef.current || '/'})
        break
      // `menu` (overlays need no unclipping here) and `hide` don't apply in the tool.
    }
  }
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== origin || event.source !== siteFrame.current?.contentWindow) return
      if (!isPreviewBarMessage(event.data)) return
      const message = event.data
      switch (message.type) {
        case 'sanity-preview-bar:frame-path': {
          setPath(message.path)
          postToBar({type: 'sanity-preview-bar:path', path: message.path})
          // The Studio's URL follows the page, as Presentation's `?preview=` does.
          const {state, navigate} = routerRef.current
          const params = ((state._searchParams as [string, string][] | undefined) ?? []).filter(
            ([key]) => key !== 'preview',
          )
          navigate({...state, _searchParams: [...params, ['preview', message.path]]} as never, {
            replace: true,
          })
          break
        }
        case 'sanity-preview-bar:refreshed':
          postToBar({type: 'sanity-preview-bar:refreshed'})
          break
        // Click-to-edit in the page: the page's document opens (or focuses) at the path, any
        // other document goes on the pane's stack.
        case 'sanity-preview-bar:edit': {
          const {stack: current, mainDocument: main} = latest.current
          setPaneWanted(true)
          // From a closed pane, another document still opens above the page's (the pane follows
          // the page, and × goes back to it).
          const base =
            current.length || !main ? current : [{id: main.id, type: main.type, params: {}}]
          applyEdit(base, message, main?.id ?? null, setStack)
          break
        }
        case 'sanity-preview-bar:describe':
          describerRef
            .current(message.nodes)
            .then((labels) => postToSite({type: 'sanity-preview-bar:labels', labels}))
            .catch((error: unknown) =>
              console.warn('sanity-preview-bar: could not describe the page', error),
            )
          break
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [origin, postToBar, postToSite])

  // Everything shows as soon as it's ready: the bar at once (Studio data), the page and the pane
  // each behind a skeleton until theirs arrives. The pane's column is held from the start, so the
  // page doesn't shift when the document opens.
  const pageLoading = path === null && !frameError

  // Like the bar on the site: the document pane runs top to bottom on the right, and the bar sits
  // beside it, above the page.
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        height: '100%',
        minHeight: 0,
        background: 'var(--card-bg-color)',
      }}
    >
      <div style={{display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0}}>
        <div style={{position: 'relative', flex: 'none', height: PREVIEW_BAR_HEIGHT}}>
          <PreviewBarView
            data={barData}
            host={barHost}
            sanity={sanityModule}
            editorState={{open: columnOpen, available: editorAvailable}}
            pageDocument={mainDocument}
          />
        </div>
        <div
          style={{
            position: 'relative',
            display: 'flex',
            // A device wider than the space (a tablet beside the pane) scrolls sideways; `safe`
            // keeps its left edge reachable instead of centring it off-screen.
            justifyContent: 'safe center',
            flex: 1,
            minHeight: 0,
            overflowX: device ? 'auto' : 'hidden',
            overflowY: 'hidden',
            // Presentation's frame backdrop: the muted card colour around the phone.
            background: 'var(--card-muted-bg-color, var(--card-bg-color))',
          }}
        >
          {frameSrc ? (
            <iframe
              ref={siteFrame}
              name={PREVIEW_BAR_FRAME_NAME}
              title="Preview"
              src={frameSrc}
              allow="clipboard-write"
              style={{
                display: 'block',
                flex: 'none',
                // Shopify's phone frame: a 4px gap above and below (square corners).
                width: device ?? '100%',
                // The Studio's global styles cap iframes at `max-width: 100%`.
                maxWidth: 'none',
                height: device ? 'calc(100% - 8px)' : '100%',
                margin: device ? '4px 0' : 0,
                border: 0,
                background: 'var(--card-bg-color)',
                boxShadow: device ? '0 0 0 1px var(--card-border-color)' : 'none',
                // The resizer's pointer stays with it while dragging over the page.
                pointerEvents: resizing ? 'none' : undefined,
                transition: ['width', 'height', 'margin']
                  .map((property) => `${property} 300ms cubic-bezier(0.2, 0, 0, 1)`)
                  .join(', '),
              }}
            />
          ) : (
            <div
              style={{
                alignSelf: 'center',
                color: 'var(--card-muted-fg-color)',
                font: 'inherit',
                fontSize: 13,
              }}
            >
              {frameError}
            </div>
          )}
          {pageLoading && <PageSkeleton />}
        </div>
      </div>
      {(paneOpen || paneLoading) && (
        <div
          data-preview-bar-panel=""
          style={{
            position: 'relative',
            flex: 'none',
            width: paneWidth,
            height: '100%',
            minHeight: 0,
            overflow: 'hidden',
            borderLeft: '1px solid var(--card-border-color)',
          }}
        >
          <PaneResizer width={paneWidth} side="right" resize={paneResize} />
          {paneOpen ? (
            <PresentationDocumentContext.Provider value={NO_LOCATIONS as never}>
              <DocumentPanel
                structure={structure}
                stack={stack}
                onChange={changeStack}
                onIntent={onIntent}
                onFocusPath={reportFocus}
                fallback={<PaneSkeleton />}
              />
            </PresentationDocumentContext.Provider>
          ) : (
            <PaneSkeleton />
          )}
        </div>
      )}
    </div>
  )
}
