/**
 * The Studio layer: for signed-in editors only, a `StudioProvider` with the project's own Studio
 * config, so the bar can use Studio state and components. `sanity` and the config load lazily
 * (they're the embedded Studio's own chunks, usually cached already). The provider gets an
 * in-memory router, so it never touches the bar's URL.
 *
 * - Search: the Studio's own `SearchPopover` (previews, filters, recent searches), pre-filtered to
 *   the types that have pages; picking a result reports `{_id, _type}` up instead of opening it.
 * - Document pane: the Studio's document editor for the page's document, in a column on the right
 *   (`DocumentPanel`); `sanity/structure` loads the first time it opens.
 *
 * The provider's router follows the bar's perspective through its sticky `perspective` and
 * `excludedPerspectives` params (what the Studio's own URL carries), so the pane edits the drafts or
 * the release version the page is showing.
 */
import {Card, Flex, Spinner} from '@sanity/ui'
import {
  type ComponentType,
  type Context,
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import {PREVIEW_BAR_HEIGHT} from '../core/protocol'
import {DocumentPanel, type PanelEntry, type StructureModule} from './DocumentPanel'

/** Loads the project's Studio config (`defineConfig(...)`), e.g. from `sanity.config.ts`. */
export type StudioConfigLoader = () => Promise<unknown>

export type StudioSearchItem = {_id: string; _type: string}

export type StudioSearch = {
  open: boolean
  /** Document types with pages; the popover opens filtered to these. */
  types: string[]
  onClose: () => void
  onSelect: (item: StudioSearchItem) => void
}

type SchemaType = {name: string; title?: string}

type SanityModule = {
  StudioProvider: ComponentType<{
    config: unknown
    basePath?: string
    unstable_history?: unknown
    unstable_noAuthBoundary?: boolean
    children: ReactNode
  }>
  SearchProvider: ComponentType<{children?: ReactNode}>
  SearchPopover: ComponentType<{
    open: boolean
    onClose: () => void
    onItemSelect: (item: StudioSearchItem) => void
    disableIntentLink?: boolean
  }>
  useSearchState: () => {
    state: {terms: {types?: SchemaType[]}}
    dispatch: (action: {type: 'TERMS_TYPE_ADD'; schemaType: SchemaType}) => void
  }
  useSchema: () => {get: (name: string) => SchemaType | undefined}
  useMiddlewareComponents: <T extends object>(props: {
    pick: (plugin: {
      studio?: {components?: {layout?: ComponentType<T>}}
    }) => ComponentType<T> | undefined
    defaultComponent: ComponentType<T>
  }) => ComponentType<T>
}

type MemoryHistory = {replace: (path: string) => void}

type Loaded = {sanity: SanityModule; config: unknown; history: MemoryHistory}

/** The document pane: its stack of documents (empty while closed) and width. */
export type StudioPanel = {
  stack: PanelEntry[]
  onChange: (stack: PanelEntry[]) => void
  width: number
  /** Top to bottom of the viewport, with the bar beside it; otherwise it stops above the bar. */
  fullHeight: boolean
}

/** Sets the Studio search's type filter to the page types once, the first time it opens. */
function TypeFilterPreset({sanity, types}: {sanity: SanityModule; types: string[]}) {
  const {state, dispatch} = sanity.useSearchState()
  const schema = sanity.useSchema()
  const done = useRef(false)
  useEffect(() => {
    if (done.current) return
    done.current = true
    const current = new Set((state.terms.types ?? []).map((type) => type.name))
    for (const name of types) {
      const schemaType = schema.get(name)
      if (schemaType && !current.has(name)) dispatch({type: 'TERMS_TYPE_ADD', schemaType})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

/**
 * The Studio's layout middleware (`studio.components.layout`) with the pane in place of the Studio's
 * own layout. Comments and Tasks mount their providers there (`AddonDatasetProvider`, …), and the
 * document pane needs them; Presentation gets them by running inside the Studio layout.
 */
const LayoutSlot = createContext<ReactNode>(null)

function LayoutSlotContent() {
  return <>{useContext(LayoutSlot)}</>
}

const layoutMiddleware = {
  pick: (plugin: {studio?: {components?: {layout?: ComponentType<object>}}}) =>
    plugin.studio?.components?.layout,
  defaultComponent: LayoutSlotContent,
}

function StudioLayoutMiddleware({sanity, children}: {sanity: SanityModule; children: ReactNode}) {
  const Layout = sanity.useMiddlewareComponents<object>(layoutMiddleware)
  return (
    <LayoutSlot.Provider value={children}>
      <Layout />
    </LayoutSlot.Provider>
  )
}

function PanelLoading() {
  return (
    <Flex align="center" justify="center" height="fill">
      <Spinner muted />
    </Flex>
  )
}

/** The pane's column: right edge, top to bottom (or down to the bar, on narrow viewports). */
/**
 * Presentation's "Preview this page" locations banner, which it adds above every document form,
 * is redundant beside the page itself. Its header renders only for the first Presentation options
 * registered in `PresentationDocumentContext` (so nested Presentation tools show one banner); this
 * outer context registers a placeholder first and ignores the plugin's own registration, so the
 * banner renders nothing. The context lives in `sanity/_singletons`, the one copy Presentation uses.
 */
const NO_LOCATIONS = {options: [{}], register: () => () => {}}

type PaneModules = {structure: StructureModule; presentationDocument: Context<unknown>}

function PanelColumn({sanity, panel}: {sanity: SanityModule; panel: StudioPanel}) {
  const [modules, setModules] = useState<PaneModules | null>(null)
  useEffect(() => {
    let cancelled = false
    Promise.all([import('sanity/structure'), import('sanity/_singletons')])
      .then(([structure, singletons]) => {
        if (cancelled) return
        setModules({
          structure: structure as unknown as StructureModule,
          presentationDocument: (
            singletons as unknown as {PresentationDocumentContext: Context<unknown>}
          ).PresentationDocumentContext,
        })
      })
      .catch((error) =>
        console.error('sanity-preview-bar: could not load the document pane', error),
      )
    return () => {
      cancelled = true
    }
  }, [])
  return (
    <Card
      data-preview-bar-panel=""
      borderLeft
      shadow={2}
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: panel.fullHeight ? 0 : PREVIEW_BAR_HEIGHT,
        width: panel.width,
        overflow: 'hidden',
      }}
    >
      {modules ? (
        <StudioLayoutMiddleware sanity={sanity}>
          <modules.presentationDocument.Provider value={NO_LOCATIONS}>
            <DocumentPanel
              structure={modules.structure}
              stack={panel.stack}
              onChange={panel.onChange}
              fallback={<PanelLoading />}
            />
          </modules.presentationDocument.Provider>
        </StudioLayoutMiddleware>
      ) : (
        <PanelLoading />
      )}
    </Card>
  )
}

export function StudioLayer({
  load,
  studioPath,
  perspective,
  panel,
  search,
  onReady,
  onError,
}: {
  load: StudioConfigLoader
  studioPath: string
  /** The bar's perspective as Studio URL params (`perspective`, `excludedPerspectives`). */
  perspective?: string
  /** The document pane, when the bar offers one. */
  panel?: StudioPanel
  search?: StudioSearch
  onReady?: () => void
  onError?: (error: unknown) => void
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const location = perspective ? `${studioPath}?${perspective}` : studioPath
  const locationRef = useRef(location)
  locationRef.current = location

  useEffect(() => {
    let cancelled = false
    Promise.all([import('sanity'), import('history'), load()])
      .then(([sanity, {createMemoryHistory}, config]) => {
        if (cancelled) return
        setLoaded({
          sanity: sanity as unknown as SanityModule,
          config,
          history: createMemoryHistory({initialEntries: [locationRef.current]}),
        })
        onReady?.()
      })
      .catch((error) => {
        console.error('sanity-preview-bar: could not load the Studio layer', error)
        onError?.(error)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, studioPath])

  // A perspective switch in the bar moves the Studio router's sticky params with it.
  useEffect(() => {
    loaded?.history.replace(location)
  }, [loaded, location])

  if (!loaded) return null
  const {sanity} = loaded
  const {StudioProvider, SearchProvider, SearchPopover} = sanity
  return (
    <StudioProvider
      config={loaded.config}
      basePath={studioPath}
      unstable_history={loaded.history}
      unstable_noAuthBoundary
    >
      {search && (
        <SearchProvider>
          {search.open && <TypeFilterPreset sanity={sanity} types={search.types} />}
          <SearchPopover
            open={search.open}
            onClose={search.onClose}
            onItemSelect={search.onSelect}
            disableIntentLink
          />
        </SearchProvider>
      )}
      {panel && panel.stack.length > 0 && <PanelColumn sanity={sanity} panel={panel} />}
    </StudioProvider>
  )
}
