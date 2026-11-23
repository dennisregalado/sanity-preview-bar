/**
 * The Visual Editor tool: Presentation's layout with the preview bar. The bar (the site's
 * `/preview-bar` route, framed with `?context=tool&position=top`) runs along the top, the site
 * (framed under `PREVIEW_BAR_FRAME_NAME`, at desktop width or as a 375px phone) fills the middle,
 * and the Studio's own document pane sits on the right.
 *
 * The tool is the bar's host here, through the same `sanity-preview-bar:*` messages the site's
 * host uses, and talks to the framed site's `mountPreviewBarFrame`: paths, refreshes after a
 * perspective switch, navigation from search. Both frames are on the site's origin, which must be
 * this Studio's origin (an embedded Studio).
 *
 * It's styled with the Studio's CSS variables and plain elements, not the bar's copy of
 * `@sanity/ui`, so it never depends on the Studio sharing that copy.
 */
import {createPreviewSecret} from '@sanity/preview-url-secret/create-secret'
import {
  urlSearchParamPreviewPathname,
  urlSearchParamPreviewSecret,
} from '@sanity/preview-url-secret/constants'
import {type CSSProperties, useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {type Tool, useClient, useCurrentUser, usePerspective} from 'sanity'
import {PresentationDocumentContext} from 'sanity/_singletons'
import {useRouter} from 'sanity/router'
import {DocumentPane, PaneLayout, PaneRouterContext, StructureToolProvider} from 'sanity/structure'
import {DocumentPanel, type PanelEntry, type StructureModule} from '../bar/DocumentPanel'
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

function useElementHeight(element: HTMLElement | null) {
  const [height, setHeight] = useState(0)
  useEffect(() => {
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setHeight(Math.round(entry.contentRect.height))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])
  return height
}

export function VisualEditorTool({tool}: {tool: Tool<VisualEditorToolOptions>}) {
  const options = tool.options ?? {}
  const barPath = options.barPath ?? PREVIEW_BAR_ROUTE
  const enablePath = options.previewUrl?.previewMode?.enable ?? '/preview/enable'
  const paneWidth = options.paneWidth ?? 420
  const origin = window.location.origin

  const router = useRouter()
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

  // Preview mode, as Presentation enables it: a fresh preview secret through the site's route.
  const client = useClient({apiVersion: '2025-02-19'})
  const currentUser = useCurrentUser()
  const [frameSrc, setFrameSrc] = useState<string | null>(null)
  const [frameError, setFrameError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    createPreviewSecret(
      client,
      'sanity-preview-bar/visual-editor',
      window.location.href,
      currentUser?.id,
    )
      .then(({secret}) => {
        if (cancelled) return
        const url = new URL(enablePath, origin)
        url.searchParams.set(urlSearchParamPreviewSecret, secret)
        url.searchParams.set(urlSearchParamPreviewPathname, initialPath)
        setFrameSrc(url.toString())
      })
      .catch((error: unknown) => {
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

  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const rootHeight = useElementHeight(root)
  const barFrame = useRef<HTMLIFrameElement | null>(null)
  const siteFrame = useRef<HTMLIFrameElement | null>(null)
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop')
  const [path, setPath] = useState<string | null>(null)
  const [mainDocument, setMainDocument] = useState<{id: string; type: string} | null>(null)
  // The pane: open with the page's document by default; closing it is remembered until Edit.
  const [stack, setStack] = useState<PanelEntry[]>([])
  const [paneWanted, setPaneWanted] = useState(true)

  const postToBar = useCallback(
    (message: PreviewBarMessage) => barFrame.current?.contentWindow?.postMessage(message, origin),
    [origin],
  )
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

  // Messages from the bar and the framed site.
  const latest = useRef({path, paneOpen, studioSelection})
  latest.current = {path, paneOpen, studioSelection}
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== origin || !isPreviewBarMessage(event.data)) return
      const message = event.data
      if (event.source === barFrame.current?.contentWindow) {
        switch (message.type) {
          case 'sanity-preview-bar:ready':
            if (latest.current.path)
              postToBar({type: 'sanity-preview-bar:path', path: latest.current.path})
            postToBar({type: 'sanity-preview-bar:editor-state', open: latest.current.paneOpen})
            break
          case 'sanity-preview-bar:menu':
            setOverlayOpen(message.open)
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
            // The page's document replaces the stack; anything else (a new document, a search
            // result without a page) goes on top, so × goes back.
            setStack((current) =>
              !template && id === mainDocument?.id
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
        }
        return
      }
      if (event.source === siteFrame.current?.contentWindow) {
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
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [origin, postToBar, postToSite, mainDocument])

  // The bar's frame spans the whole tool so its menus can open over the page and the pane; it's
  // clipped to the bar's height except while one is open, as on the site.
  const barWrapper: CSSProperties = {
    position: 'absolute',
    inset: '0 0 auto 0',
    height: overlayOpen ? rootHeight : PREVIEW_BAR_HEIGHT,
    overflow: overlayOpen ? 'visible' : 'hidden',
    zIndex: 10,
  }

  return (
    <div
      ref={setRoot}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: 'var(--card-bg-color)',
      }}
    >
      <div style={{position: 'relative', flex: 'none', height: PREVIEW_BAR_HEIGHT}}>
        <div style={barWrapper}>
          <iframe
            ref={barFrame}
            title="Sanity preview bar"
            src={`${barPath}?context=tool&position=top`}
            allow="clipboard-write"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              display: 'block',
              width: '100%',
              height: Math.max(rootHeight, PREVIEW_BAR_HEIGHT),
              border: 0,
              colorScheme: 'normal',
            }}
          />
        </div>
      </div>
      <div style={{display: 'flex', flex: 1, minHeight: 0}}>
        <div
          style={{
            position: 'relative',
            display: 'flex',
            justifyContent: 'center',
            flex: 1,
            minWidth: 0,
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
              {frameError ?? 'Opening preview…'}
            </div>
          )}
        </div>
        {paneOpen && (
          <div
            data-preview-bar-panel=""
            style={{
              position: 'relative',
              flex: 'none',
              width: paneWidth,
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
      </div>
    </div>
  )
}
