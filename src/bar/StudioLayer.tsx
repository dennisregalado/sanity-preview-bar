/**
 * The Studio layer: for signed-in editors only, a `StudioProvider` with the project's own Studio
 * config, so the bar can use Studio state and components. `sanity` and the config load lazily
 * (they're the embedded Studio's own chunks, usually cached already). The provider gets an
 * in-memory router, so it never touches the bar's URL.
 *
 * - Presence: reported up; the bar draws the avatars with its own Sanity UI.
 * - Search: the Studio's own `SearchPopover` (previews, filters, recent searches), pre-filtered to
 *   the types that have pages; picking a result reports `{_id, _type}` up instead of opening it.
 */
import {type ComponentType, type ReactNode, useEffect, useRef, useState} from 'react'

/** Loads the project's Studio config (`defineConfig(...)`), e.g. from `sanity.config.ts`. */
export type StudioConfigLoader = () => Promise<unknown>

export type PresenceUser = {id: string; name?: string; imageUrl?: string}

export type StudioSearchItem = {_id: string; _type: string}

/** The page's document, live from the Studio: the bar's status chip renders this. */
export type PageDocumentStatus = {
  id: string
  type: string
  /** The schema type's title, e.g. "Page". */
  typeTitle: string
  /** The schema's own preview title. */
  title: string
  /** `_updatedAt` of each version that exists. */
  draft: string | null
  published: string | null
  /** Release versions, by release ID. */
  versions: Record<string, string>
  /** Who has this document open in the Studio right now. */
  editors: PresenceUser[]
}

export type StudioSearch = {
  open: boolean
  /** Document types with pages; the popover opens filtered to these. */
  types: string[]
  onClose: () => void
  onSelect: (item: StudioSearchItem) => void
}

type SchemaType = {name: string; title?: string}

type StudioUser = {id: string; displayName?: string; imageUrl?: string}

type SanityModule = {
  StudioProvider: ComponentType<{
    config: unknown
    basePath?: string
    unstable_history?: unknown
    unstable_noAuthBoundary?: boolean
    children: ReactNode
  }>
  useGlobalPresence: () => Array<{user: {id: string; displayName?: string; imageUrl?: string}}>
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
  useEditState: (
    id: string,
    type: string,
  ) => {
    ready: boolean
    draft: {_updatedAt?: string} | null
    published: {_updatedAt?: string} | null
  }
  useDocumentPresence: (id: string) => Array<{user: StudioUser}>
  useDocumentVersionInfo: (id: string) => {
    isLoading: boolean
    versions: Record<string, {_updatedAt?: string} | undefined>
  }
  useValuePreview: (props: {schemaType?: SchemaType; value: unknown}) => {
    isLoading?: boolean
    value?: {title?: unknown} | null
  }
}

type Loaded = {sanity: SanityModule; config: unknown; history: unknown}

function PresenceBridge({
  useGlobalPresence,
  onPresence,
}: {
  useGlobalPresence: SanityModule['useGlobalPresence']
  onPresence: (users: PresenceUser[]) => void
}) {
  const presence = useGlobalPresence()
  const key = presence.map((entry) => entry.user.id).join(',')
  useEffect(() => {
    onPresence(
      presence.map(({user}) => ({id: user.id, name: user.displayName, imageUrl: user.imageUrl})),
    )
    // Report when the set of users changes, not on every location update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return null
}

/** Reads the page document's versions, preview title and editors, and reports them up. */
function DocumentBridge({
  sanity,
  document,
  onStatus,
}: {
  sanity: SanityModule
  document: {_id: string; _type: string}
  onStatus: (status: PageDocumentStatus | null) => void
}) {
  const editState = sanity.useEditState(document._id, document._type)
  const schemaType = sanity.useSchema().get(document._type)
  const value = editState.draft ?? editState.published
  const preview = sanity.useValuePreview({schemaType, value: value ?? undefined})
  const presence = sanity.useDocumentPresence(document._id)
  const versionInfo = sanity.useDocumentVersionInfo(document._id)
  const versions = Object.fromEntries(
    Object.entries(versionInfo.versions).flatMap(([releaseId, stub]) =>
      stub?._updatedAt ? [[releaseId, stub._updatedAt]] : [],
    ),
  )
  const versionsKey = JSON.stringify(versions)

  const title = typeof preview.value?.title === 'string' ? preview.value.title : ''
  const draft = editState.draft?._updatedAt ?? null
  const published = editState.published?._updatedAt ?? null
  const editorIds = [...new Set(presence.map((entry) => entry.user.id))]
  const editorKey = editorIds.join(',')

  useEffect(() => {
    if (!editState.ready) return
    const seen = new Set<string>()
    onStatus({
      id: document._id,
      type: document._type,
      typeTitle: schemaType?.title ?? document._type,
      title: title || 'Untitled',
      draft,
      published,
      versions,
      editors: presence.flatMap(({user}) => {
        if (seen.has(user.id)) return []
        seen.add(user.id)
        return [{id: user.id, name: user.displayName, imageUrl: user.imageUrl}]
      }),
    })
    // `presence` changes identity on location updates; the editor set is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    editState.ready,
    document._id,
    document._type,
    title,
    draft,
    published,
    versionsKey,
    editorKey,
  ])

  useEffect(() => () => onStatus(null), [document._id, onStatus])
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

export function StudioLayer({
  load,
  studioPath,
  onPresence,
  search,
  document,
  onDocumentStatus,
  onReady,
  onError,
}: {
  load: StudioConfigLoader
  studioPath: string
  onPresence: (users: PresenceUser[]) => void
  search?: StudioSearch
  /** The page's document, when known; its live status goes to `onDocumentStatus`. */
  document?: {_id: string; _type: string} | null
  onDocumentStatus?: (status: PageDocumentStatus | null) => void
  onReady?: () => void
  onError?: (error: unknown) => void
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([import('sanity'), import('history'), load()])
      .then(([sanity, {createMemoryHistory}, config]) => {
        if (cancelled) return
        setLoaded({
          sanity: sanity as unknown as SanityModule,
          config,
          history: createMemoryHistory({initialEntries: [studioPath]}),
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

  if (!loaded) return null
  const {sanity} = loaded
  const {StudioProvider, SearchProvider, SearchPopover, useGlobalPresence} = sanity
  return (
    <StudioProvider
      config={loaded.config}
      basePath={studioPath}
      unstable_history={loaded.history}
      unstable_noAuthBoundary
    >
      <PresenceBridge useGlobalPresence={useGlobalPresence} onPresence={onPresence} />
      {document && onDocumentStatus && (
        <DocumentBridge
          key={document._id}
          sanity={sanity}
          document={document}
          onStatus={onDocumentStatus}
        />
      )}
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
    </StudioProvider>
  )
}
