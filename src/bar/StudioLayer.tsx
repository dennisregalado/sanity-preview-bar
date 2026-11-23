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
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import {PREVIEW_BAR_HEIGHT, type PaneSide} from '../core/protocol'
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
  ALL_FIELDS_GROUP: {name: string}
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
  useClient: (options: {apiVersion: string}) => unknown
  useCurrentUser: () => {id: string} | null
  useMiddlewareComponents: <T extends object>(props: {
    pick: (plugin: {
      studio?: {components?: {layout?: ComponentType<T>}}
    }) => ComponentType<T> | undefined
    defaultComponent: ComponentType<T>
  }) => ComponentType<T>
}

type MemoryHistory = {
  location: {pathname: string; search: string}
  replace: (path: string) => void
  listen: (listener: (update: {location: {search: string}}) => void) => () => void
}

/** The perspective params as the bar's menu selection (no param is drafts, as in the Studio). */
function selectionFromParams(search: string) {
  const params = new URLSearchParams(search)
  const excluded = params.get('excludedPerspectives')
  return {
    selected: params.get('perspective') || 'drafts',
    excluded: excluded ? excluded.split(',').filter(Boolean) : [],
  }
}

/** The perspective sticky params the bar controls. */
const PERSPECTIVE_PARAMS = ['perspective', 'excludedPerspectives']

type SchemaDefinition = {groups?: Array<{name: string}>; fields?: unknown[]; of?: unknown[]}

/** Hides the "All fields" group on a type with field groups, and on inline object fields in it. */
function hideAllFieldsGroup(definition: unknown, allFields: {name: string}): unknown {
  if (typeof definition !== 'object' || definition === null) return definition
  const type = definition as SchemaDefinition
  let next: SchemaDefinition = type
  if (Array.isArray(type.groups) && type.groups.length > 0) {
    const groups = type.groups.some((group) => group.name === allFields.name)
      ? type.groups.map((group) =>
          group.name === allFields.name ? {...group, hidden: true} : group,
        )
      : [{...allFields, hidden: true}, ...type.groups]
    next = {...next, groups}
  }
  if (Array.isArray(type.fields)) {
    next = {...next, fields: type.fields.map((field) => hideAllFieldsGroup(field, allFields))}
  }
  if (Array.isArray(type.of)) {
    next = {...next, of: type.of.map((member) => hideAllFieldsGroup(member, allFields))}
  }
  return next
}

/**
 * The project's config with "All fields" hidden (Sanity's `ALL_FIELDS_GROUP` with `hidden: true`)
 * on every type that has field groups. The root config's `schema.types` resolves after every
 * plugin's, so wrapping it sees all types. Only the bar's own copy of the config changes; the
 * Studio itself still shows the group.
 */
function withoutAllFieldsGroup(config: unknown, allFields: {name: string}): unknown {
  type Types = unknown[] | ((previous: unknown[], context: unknown) => unknown[]) | undefined
  const hide = (types: unknown[]) => types.map((type) => hideAllFieldsGroup(type, allFields))
  const add = (workspace: unknown) => {
    const value = workspace as {schema?: {types?: Types}}
    const types = value.schema?.types
    return {
      ...value,
      schema: {
        ...value.schema,
        types: (previous: unknown[], context: unknown) =>
          hide(
            typeof types === 'function'
              ? types(previous, context)
              : [...previous, ...(types ?? [])],
          ),
      },
    }
  }
  return Array.isArray(config) ? config.map(add) : add(config)
}

type Loaded = {sanity: SanityModule; config: unknown; history: MemoryHistory}

/** The document pane: its stack of documents (empty while closed) and width. */
export type StudioPanel = {
  stack: PanelEntry[]
  onChange: (stack: PanelEntry[]) => void
  width: number
  /** Top to bottom of the viewport, with the bar beside it; otherwise it stops at the bar. */
  fullHeight: boolean
  /** Which edge the bar is on, for the overlaying (not full-height) pane. */
  barPosition: 'top' | 'bottom'
  /** Which edge of the viewport the pane sits on. */
  side: PaneSide
  /** Drag (or arrow-key) resizing from the pane's inner edge; `null` when it overlays the page. */
  resize: {start: () => void; to: (width: number) => void; end: () => void} | null
}

/** Intent parameters from a Studio intent path segment, `id=abc;type=page`. */
function intentParams(segment: string) {
  return Object.fromEntries(
    segment.split(';').flatMap((pair) => {
      const [key, value] = pair.split('=')
      return key && value !== undefined
        ? [[decodeURIComponent(key), decodeURIComponent(value)]]
        : []
    }),
  ) as Record<string, string>
}

/** The Studio's URL for an intent, `/studio/intent/edit/id=abc;type=page`. */
function intentHref(studioPath: string, name: string, params: Record<string, string>) {
  const segment = Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join(';')
  return `${studioPath}/intent/${encodeURIComponent(name)}/${segment}`
}

/** Studio's pane resizer: an invisible strip on the pane's edge that shows a line while in use. */
function PaneResizer({
  width,
  side,
  resize,
}: {
  width: number
  side: PaneSide
  resize: NonNullable<StudioPanel['resize']>
}) {
  // Moving the pointer away from the pane's own edge widens it.
  const direction = side === 'right' ? -1 : 1
  const drag = useRef<{x: number; width: number} | null>(null)
  const [active, setActive] = useState(false)

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = {x: event.clientX, width}
    setActive(true)
    resize.start()
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return
    resize.to(drag.current.width + direction * (event.clientX - drag.current.x))
  }
  function onPointerUp() {
    if (!drag.current) return
    drag.current = null
    setActive(false)
    resize.end()
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 64 : 16
    if (event.key === 'ArrowLeft') resize.to(width - direction * step)
    else if (event.key === 'ArrowRight') resize.to(width + direction * step)
    else return
    event.preventDefault()
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize editor"
      aria-valuenow={width}
      tabIndex={0}
      className="preview-bar-pane-resizer"
      data-side={side}
      data-active={active ? '' : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      onKeyUp={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') resize.end()
      }}
    />
  )
}

/** Reports the editor's Studio client and user ID (the share menu's sharing switch). */
function SharingClientBridge({
  sanity,
  onClient,
}: {
  sanity: SanityModule
  onClient: (studio: {client: unknown; userId?: string} | null) => void
}) {
  const client = sanity.useClient({apiVersion: '2025-02-19'})
  const userId = sanity.useCurrentUser()?.id
  useEffect(() => {
    onClient({client, userId})
    return () => onClient(null)
  }, [client, userId, onClient])
  return null
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

/**
 * Studio links in the pane (intent links, links to other tools) would navigate the bar's in-memory
 * router, which shows nothing. A capture listener on the pane takes their clicks first (React
 * handles clicks at its root, after this): an edit intent opens in the pane, anything else opens
 * the Studio in a new tab. Links with `#` (the pane's own router links) are left alone.
 */
function useStudioLinks(
  studioPath: string,
  onIntent: (name: string, params: Record<string, string>) => void,
) {
  const [element, setElement] = useState<HTMLElement | null>(null)
  useEffect(() => {
    if (!element) return
    const root = studioPath.replace(/\/$/, '')
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return
      const anchor = (event.target as Element | null)?.closest?.('a[href]')
      if (!anchor || !element?.contains(anchor)) return
      const url = new URL(anchor.getAttribute('href') ?? '', window.location.href)
      if (url.origin !== window.location.origin || !url.pathname.startsWith(`${root}/`)) return
      event.preventDefault()
      event.stopPropagation()
      const intent = url.pathname.slice(root.length).match(/^\/intent\/([^/]+)\/([^/]*)/)
      if (intent?.[1] && !(event.metaKey || event.ctrlKey || event.shiftKey)) {
        onIntent(decodeURIComponent(intent[1]), intentParams(intent[2] ?? ''))
        return
      }
      window.open(`${url.pathname}${url.search}`, '_blank', 'noopener')
    }
    element.addEventListener('click', onClick, true)
    return () => element.removeEventListener('click', onClick, true)
  }, [element, studioPath, onIntent])
  return setElement
}

function PanelColumn({
  sanity,
  panel,
  studioPath,
  onIntent,
}: {
  sanity: SanityModule
  panel: StudioPanel
  studioPath: string
  onIntent: (name: string, params: Record<string, string>) => void
}) {
  const linksRef = useStudioLinks(studioPath, onIntent)
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
    <div
      ref={linksRef}
      data-preview-bar-panel=""
      style={{
        position: 'fixed',
        top: !panel.fullHeight && panel.barPosition === 'top' ? PREVIEW_BAR_HEIGHT : 0,
        [panel.side]: 0,
        bottom: !panel.fullHeight && panel.barPosition === 'bottom' ? PREVIEW_BAR_HEIGHT : 0,
        width: panel.width,
      }}
    >
      <Card
        borderLeft={panel.side === 'right'}
        borderRight={panel.side === 'left'}
        shadow={2}
        height="fill"
        overflow="hidden"
      >
        {modules ? (
          <StudioLayoutMiddleware sanity={sanity}>
            <modules.presentationDocument.Provider value={NO_LOCATIONS}>
              <DocumentPanel
                structure={modules.structure}
                stack={panel.stack}
                onChange={panel.onChange}
                onIntent={onIntent}
                fallback={<PanelLoading />}
              />
            </modules.presentationDocument.Provider>
          </StudioLayoutMiddleware>
        ) : (
          <PanelLoading />
        )}
      </Card>
      {panel.resize && <PaneResizer width={panel.width} side={panel.side} resize={panel.resize} />}
    </div>
  )
}

export function StudioLayer({
  load,
  studioPath,
  perspective,
  onPerspectiveChange,
  onSharingClient,
  panel,
  allFieldsGroup = true,
  search,
  onReady,
  onError,
}: {
  load: StudioConfigLoader
  studioPath: string
  /** The bar's perspective as Studio URL params (`perspective`, `excludedPerspectives`). */
  perspective?: string
  /**
   * The Studio switched perspective itself (the document pane's Published / Draft / release chips,
   * "View draft"): the bar switches the site to match.
   */
  onPerspectiveChange?: (selection: {selected: string; excluded: string[]}) => void
  /** Receives the editor's Studio client and user ID, for toggling Presentation's sharing. */
  onSharingClient?: (studio: {client: unknown; userId?: string} | null) => void
  /** The document pane, when the bar offers one. */
  panel?: StudioPanel
  /** `false` hides field groups' "All fields" tab in this copy of the Studio. */
  allFieldsGroup?: boolean
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
        const studio = sanity as unknown as SanityModule
        setLoaded({
          sanity: studio,
          config: allFieldsGroup ? config : withoutAllFieldsGroup(config, studio.ALL_FIELDS_GROUP),
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

  // A perspective switch in the bar moves the Studio router's sticky params with it. Only the params
  // change: the router redirects the bare base path to a tool, and while it resolves a path it has
  // no state, so `WorkspaceRouterProvider` swaps its children for a loading screen, which remounted
  // the document pane on every switch.
  useEffect(() => {
    if (!loaded) return
    const {pathname, search} = loaded.history.location
    const params = new URLSearchParams(search)
    for (const name of PERSPECTIVE_PARAMS) params.delete(name)
    for (const [name, value] of new URLSearchParams(perspective ?? '')) params.set(name, value)
    const query = params.toString()
    const next = query ? `${pathname}?${query}` : pathname
    if (next !== `${pathname}${search}`) loaded.history.replace(next)
  }, [loaded, perspective])

  // And the other way: when the Studio's router changes the perspective params (the pane's chips),
  // tell the bar, which stores the cookie and refreshes the site like its own menu does.
  const perspectiveRef = useRef({perspective, onPerspectiveChange})
  perspectiveRef.current = {perspective, onPerspectiveChange}
  useEffect(() => {
    if (!loaded) return
    return loaded.history.listen(({location: next}) => {
      const {perspective: current, onPerspectiveChange: report} = perspectiveRef.current
      const studio = selectionFromParams(next.search)
      const bar = selectionFromParams(current ?? '')
      const same =
        studio.selected === bar.selected &&
        [...studio.excluded].sort().join() === [...bar.excluded].sort().join()
      if (same) return
      report?.(studio)
    })
  }, [loaded])

  // Intents the pane can't show itself: an edit intent for a document opens it in the pane;
  // anything else opens in the Studio, in a new tab.
  const panelRef = useRef(panel)
  panelRef.current = panel
  const openIntent = useRef((name: string, params: Record<string, string>) => {
    const current = panelRef.current
    if (name === 'edit' && params.id && params.type && current && current.stack.length > 0) {
      current.onChange([...current.stack, {id: params.id, type: params.type, params: {}}])
      return
    }
    window.open(intentHref(studioPath, name, params), '_blank', 'noopener')
  }).current

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
      {onSharingClient && <SharingClientBridge sanity={sanity} onClient={onSharingClient} />}
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
      {panel && panel.stack.length > 0 && (
        <PanelColumn sanity={sanity} panel={panel} studioPath={studioPath} onIntent={openIntent} />
      )}
    </StudioProvider>
  )
}
