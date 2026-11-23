/**
 * The Visual Editor tool: Presentation's layout with the preview bar. The bar runs along the top,
 * rendered natively in the Studio (`PreviewBarView`, with the Studio's own context), the site
 * (framed under `PREVIEW_BAR_FRAME_NAME`, at desktop width or as a 375px phone) fills the middle,
 * and the Studio's own document pane sits on the right.
 *
 * The tool is the bar's host, through the same `sanity-preview-bar:*` messages the site's host
 * uses (in process, no frame), and talks to the framed site's `mountPreviewBarFrame`: paths,
 * refreshes after a perspective switch, navigation from search. The site is framed on its origin,
 * which must be this Studio's origin (an embedded Studio); the bar's data comes from its
 * `/preview-bar/data` route.
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
import {type Tool, useClient, useCurrentUser, usePerspective, useWorkspace} from 'sanity'
import {PresentationDocumentContext} from 'sanity/_singletons'
import {useRouter} from 'sanity/router'
import {DocumentPane, PaneLayout, PaneRouterContext, StructureToolProvider} from 'sanity/structure'
import {DocumentPanel, type PanelEntry, type StructureModule} from '../bar/DocumentPanel'
import {type BarHost, PreviewBarView} from '../bar/PreviewBar'
import type {PreviewBarData} from '../core/data'
import {
  isPreviewBarMessage,
  PREVIEW_BAR_FRAME_NAME,
  PREVIEW_BAR_HEIGHT,
  PREVIEW_BAR_ROUTE,
  type PreviewBarMessage,
  type PreviewBarSelection,
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
  /** The document pane's width. Default 420. */
  paneWidth?: number
  /**
   * Hide the Studio's navbar while the tool is open, so the preview bar is the only toolbar (its
   * logo goes back to the Studio). Default `true`.
   */
  hideStudioNavbar?: boolean
}

const MOBILE_WIDTH = 375

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

const SKELETON_CSS = `
@keyframes preview-bar-skeleton { from { opacity: 1; } to { opacity: 0.45; } }
.preview-bar-skeleton { background: var(--card-skeleton-color-from, var(--card-border-color)); border-radius: 3px; animation: preview-bar-skeleton 0.9s ease-in-out infinite alternate; }
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

/** The tool's layout in skeleton form: the bar, the page and the pane column. */
function ToolSkeleton({paneWidth}: {paneWidth: number}) {
  return (
    <div
      aria-busy="true"
      aria-label="Loading the Visual Editor"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 20,
        display: 'flex',
        background: 'var(--card-bg-color)',
      }}
    >
      <style>{SKELETON_CSS}</style>
      <div style={{display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0}}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flex: 'none',
            height: PREVIEW_BAR_HEIGHT,
            padding: '0 12px',
            borderBottom: '1px solid var(--card-border-color)',
          }}
        >
          <Bone width={25} height={25} />
          <Bone width={110} height={13} />
          <Bone width={96} height={27} style={{borderRadius: 14}} />
          <div style={{flex: 1}} />
          <Bone width={21} height={21} />
          <Bone width={21} height={21} />
          <Bone width={21} height={21} />
        </div>
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            padding: 24,
            background: 'var(--card-muted-bg-color, var(--card-bg-color))',
          }}
        >
          <Bone width="100%" height={56} />
          <Bone width="100%" height="45%" />
          <Bone width="40%" height={20} />
          <Bone width="65%" height={20} />
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
          flex: 'none',
          width: paneWidth,
          padding: '14px 16px',
          borderLeft: '1px solid var(--card-border-color)',
        }}
      >
        <div style={{display: 'flex', gap: 8}}>
          <Bone width={88} height={25} style={{borderRadius: 13}} />
          <Bone width={60} height={25} style={{borderRadius: 13}} />
        </div>
        <Bone width="45%" height={22} />
        <Bone width="30%" height={13} />
        <Bone width="100%" height={36} />
        <Bone width="30%" height={13} />
        <Bone width="100%" height={120} />
        <Bone width="30%" height={13} />
        <Bone width="100%" height={36} />
      </div>
    </div>
  )
}

export function VisualEditorTool({tool}: {tool: Tool<VisualEditorToolOptions>}) {
  const options = tool.options ?? {}
  const barPath = options.barPath ?? PREVIEW_BAR_ROUTE
  const enablePath = options.previewUrl?.previewMode?.enable ?? '/preview/enable'
  const paneWidth = options.paneWidth ?? 420
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

  // The bar's data, from its route (404 outside preview mode).
  const [barData, setBarData] = useState<PreviewBarData | null>(null)
  const fetchBarData = useCallback(async () => {
    const response = await fetch(`${barPath}/data`, {credentials: 'same-origin'})
    return response.ok ? ((await response.json()) as PreviewBarData) : null
  }, [barPath])

  // Fast start: when the editor is already in preview mode (the bar's data answers), the bar
  // renders at once and the site loads directly. Otherwise preview mode is enabled as Presentation
  // does it: a fresh preview secret through the site's route, and the bar follows the frame.
  const client = useClient({apiVersion: '2025-02-19'})
  const currentUser = useCurrentUser()
  const [frameSrc, setFrameSrc] = useState<string | null>(null)
  const [frameError, setFrameError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    async function start() {
      const data = await fetchBarData().catch(() => null)
      if (cancelled) return
      if (data) {
        setBarData(data)
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
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop')
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

  // First visit (no preview cookie yet): the bar's data once the framed site is in preview mode.
  const pathKnown = path !== null
  useEffect(() => {
    if (!pathKnown || barData) return
    let cancelled = false
    fetchBarData()
      .then((data) => {
        if (!cancelled && data) setBarData(data)
      })
      .catch((error: unknown) => console.error('sanity-preview-bar: could not load the bar', error))
    return () => {
      cancelled = true
    }
  }, [pathKnown, barData, fetchBarData])
  const postToSite = useCallback(
    (message: PreviewBarMessage) => siteFrame.current?.contentWindow?.postMessage(message, origin),
    [origin],
  )

  // The page's main document, from the bar's route (Presentation's `mainDocuments` rules).
  useEffect(() => {
    if (path === null) return
    let cancelled = false
    fetch(`${barPath}/document?${new URLSearchParams({path})}`, {credentials: 'same-origin'})
      .then((response) => (response.ok ? response.json() : {document: null}))
      .then(({document}: {document: {_id: string; _type: string} | null}) => {
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
  }, [path, barPath])

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

  const paneOpen = stack.length > 0
  useEffect(() => {
    postToBar({type: 'sanity-preview-bar:editor-state', open: paneOpen})
  }, [paneOpen, postToBar])

  const changeStack = useCallback((next: PanelEntry[]) => {
    if (next.length === 0) setPaneWanted(false)
    setStack(next)
  }, [])

  // Perspective, both ways: the bar's switches move the Studio's sticky params; the Studio's own
  // switches (the pane's chips, the navbar menu) go to the bar, which stores them and refreshes.
  const {selectedPerspectiveName, excludedPerspectives} = usePerspective()
  const studioSelection = useMemo<PreviewBarSelection>(
    () => ({selected: selectedPerspectiveName ?? 'drafts', excluded: excludedPerspectives ?? []}),
    [selectedPerspectiveName, excludedPerspectives],
  )
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
  const latest = useRef({path, paneOpen, studioSelection, mainDocument})
  latest.current = {path, paneOpen, studioSelection, mainDocument}
  pathRef.current = path
  handleBarMessage.current = (message) => {
    switch (message.type) {
      case 'sanity-preview-bar:ready':
        // After the bar's other listeners subscribe (the same commit's effects run first).
        queueMicrotask(() => {
          const {path: current, paneOpen: open} = latest.current
          if (current) postToBar({type: 'sanity-preview-bar:path', path: current})
          postToBar({type: 'sanity-preview-bar:editor-state', open})
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
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [origin, postToBar])

  // A skeleton of the whole tool until the bar, the page and the pane's document are all in, so
  // they appear at once instead of shifting the layout one by one (at most 10s).
  const [timedOut, setTimedOut] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => setTimedOut(true), 10_000)
    return () => window.clearTimeout(timer)
  }, [])
  const ready = Boolean(barData) && path !== null && mainDocumentLoaded
  const showSkeleton = !ready && !timedOut && !frameError

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
          {barData && <PreviewBarView data={barData} host={barHost} sanity={sanityModule} />}
        </div>
        <div
          style={{
            position: 'relative',
            display: 'flex',
            justifyContent: 'center',
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
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
                width: viewport === 'mobile' ? MOBILE_WIDTH : '100%',
                height: '100%',
                border: 0,
                background: 'var(--card-bg-color)',
                boxShadow: viewport === 'mobile' ? '0 0 0 1px var(--card-border-color)' : 'none',
                transition: 'width 300ms cubic-bezier(0.2, 0, 0, 1)',
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
        </div>
      </div>
      {paneOpen && (
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
          <PresentationDocumentContext.Provider value={NO_LOCATIONS as never}>
            <DocumentPanel
              structure={structure}
              stack={stack}
              onChange={changeStack}
              onIntent={onIntent}
              fallback={null}
            />
          </PresentationDocumentContext.Provider>
        </div>
      )}
      {showSkeleton && <ToolSkeleton paneWidth={paneWidth} />}
    </div>
  )
}
