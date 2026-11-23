/**
 * "Used on" for the Visual Editor: Presentation's document locations (`resolve.locations`, the same
 * `defineLocations` resolvers) without the Presentation tool. Every document form gets
 * Presentation's banner: "Used on N pages", expanding to the pages, each opening the Visual Editor
 * on that page.
 *
 * Resolvers take Presentation's three forms: per type, `{select, resolve}` (the selected fields,
 * live through the preview store) or a fixed state; or one function for every type, given the
 * document and the Studio's document store.
 */
import ChevronRightIcon from '@sanity/icons/ChevronRight'
import DesktopIcon from '@sanity/icons/Desktop'
import ErrorOutlineIcon from '@sanity/icons/ErrorOutline'
import InfoOutlineIcon from '@sanity/icons/InfoOutline'
import WarningOutlineIcon from '@sanity/icons/WarningOutline'
import {Box, Card, Flex, Spinner, Text} from '@sanity/ui'
import {
  type ComponentType,
  type CSSProperties,
  createElement,
  type MouseEvent,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from 'react'
import {
  FormRow,
  getPublishedId,
  getVersionFromId,
  type InputProps,
  isDocumentSchemaType,
  type ObjectSchemaType,
  useDocumentPreviewStore,
  useDocumentStore,
  usePerspective,
  useWorkspace,
} from 'sanity'
import {PresentationDocumentContext} from 'sanity/_singletons'
import type {
  DocumentLocation,
  DocumentLocationResolver,
  DocumentLocationResolvers,
  DocumentLocationsState,
} from 'sanity/presentation'
import {useRouter} from 'sanity/router'

export type VisualEditorLocations = DocumentLocationResolvers | DocumentLocationResolver

type Status = 'empty' | 'resolving' | 'resolved'
type Result = {state: DocumentLocationsState; status: Status}

const NO_LOCATIONS: DocumentLocationsState = {locations: []}

type Subscribable<T> = {subscribe: (next: (value: T) => void) => {unsubscribe: () => void}}

function isSubscribable<T>(value: unknown): value is Subscribable<T> {
  return typeof (value as Subscribable<T> | null)?.subscribe === 'function'
}

/** Presentation's `useDocumentLocations`: the resolver's state, live. */
function useDocumentLocations({
  id,
  version,
  schemaType,
  resolvers,
}: {
  id: string
  version: string | undefined
  schemaType: ObjectSchemaType
  resolvers: VisualEditorLocations
}): Result {
  const documentStore = useDocumentStore()
  const previewStore = useDocumentPreviewStore()
  const {perspectiveStack} = usePerspective()
  const resolver = typeof resolvers === 'function' ? resolvers : resolvers[schemaType.name]
  const [result, setResult] = useState<Result>({
    state: NO_LOCATIONS,
    status: resolver ? 'resolving' : 'empty',
  })
  const stackKey = JSON.stringify(perspectiveStack)

  useEffect(() => {
    if (!resolver) {
      setResult({state: NO_LOCATIONS, status: 'empty'})
      return
    }
    const settle = (state: DocumentLocationsState | null | undefined | void) =>
      setResult(state ? {state, status: 'resolved'} : {state: NO_LOCATIONS, status: 'empty'})

    if (typeof resolver === 'object' && 'select' in resolver && 'resolve' in resolver) {
      // The selected fields, through the preview store, as Presentation reads them.
      const subscription = previewStore
        .observeForPreview(
          {_type: 'reference', _ref: id} as never,
          {...schemaType, preview: {select: resolver.select}} as never,
          {perspective: perspectiveStack as never},
        )
        .subscribe((preview) =>
          settle(resolver.resolve((preview.snapshot as Record<string, unknown> | null) ?? null)),
        )
      return () => subscription.unsubscribe()
    }
    const source: unknown =
      typeof resolver === 'function'
        ? resolver(
            {id, type: schemaType.name, version, perspectiveStack: perspectiveStack as never},
            {documentStore},
          )
        : resolver

    if (!isSubscribable<DocumentLocationsState | null | undefined>(source)) {
      settle(source as DocumentLocationsState | null | undefined)
      return
    }
    const subscription = source.subscribe(settle)
    return () => subscription.unsubscribe()
    // `perspectiveStack` by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolver, id, version, schemaType, documentStore, previewStore, stackKey])

  return result
}

const TONE_ICONS = {
  positive: InfoOutlineIcon,
  caution: WarningOutlineIcon,
  critical: ErrorOutlineIcon,
}

/** ui5's `Icon size={1}` in the Studio: 21px, pulled in by `-0.375rem`. */
function BannerIcon({icon, style}: {icon: ComponentType; style?: CSSProperties}) {
  return (
    <span
      aria-hidden="true"
      style={{display: 'block', fontSize: 21, lineHeight: 0, margin: '-0.375rem', ...style}}
    >
      {createElement(icon as ComponentType<{style?: CSSProperties}>, {
        style: {display: 'block'},
      })}
    </span>
  )
}

function countLabel(count: number) {
  if (count === 0) return 'Not used on any pages'
  if (count === 1) return 'Used on one page'
  return `Used on ${count} pages`
}

/** A page the document is on: opens the Visual Editor there, keeping the Studio's perspective. */
function LocationItem({location, toolName}: {location: DocumentLocation; toolName: string}) {
  const {basePath} = useWorkspace()
  const router = useRouter()
  const search = new URLSearchParams({preview: location.href})
  if (typeof window !== 'undefined') {
    const current = new URLSearchParams(window.location.search)
    for (const key of ['perspective', 'excludedPerspectives']) {
      const value = current.get(key)
      if (value) search.set(key, value)
    }
  }
  const href = `${basePath.replace(/\/$/, '')}/${toolName}?${search}`
  const Icon = location.icon ?? DesktopIcon
  return (
    <Card
      as="a"
      href={href}
      padding={3}
      radius={1}
      tone="inherit"
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
        event.preventDefault()
        router.navigateUrl({path: href})
      }}
    >
      <Flex gap={3}>
        <Box flex="none">
          <BannerIcon icon={Icon} />
        </Box>
        <Flex flex={1} gap={2} direction="column">
          <Text size={1} weight="medium" as="div">
            {location.title}
          </Text>
          {location.showHref !== false && (
            <Text muted size={1} textOverflow="ellipsis" as="div">
              {location.href}
            </Text>
          )}
        </Flex>
      </Flex>
    </Card>
  )
}

/** Presentation's `LocationsBanner`. */
function LocationsBanner({
  id,
  version,
  schemaType,
  resolvers,
  toolName,
}: {
  id: string
  version: string | undefined
  schemaType: ObjectSchemaType
  resolvers: VisualEditorLocations
  toolName: string
}) {
  const {state, status} = useDocumentLocations({id, version, schemaType, resolvers})
  const [expanded, setExpanded] = useState(false)
  if (status === 'empty') return null
  const {locations, message, tone} = state
  const count = locations?.length ?? 0
  const resolving = status === 'resolving'
  const title = resolving ? 'Resolving locations...' : message || countLabel(count)
  const ToneIcon = tone ? TONE_ICONS[tone] : undefined

  let content: ReactNode
  if (!locations) {
    content = (
      <Flex align="flex-start" gap={3} padding={3}>
        {ToneIcon && (
          <Box flex="none">
            <BannerIcon icon={ToneIcon} />
          </Box>
        )}
        <Box flex={1}>
          <Text size={1} weight="medium" as="div">
            {title}
          </Text>
        </Box>
      </Flex>
    )
  } else {
    content = (
      <>
        <Card
          as={count ? 'button' : undefined}
          onClick={count ? () => setExpanded((value) => !value) : undefined}
          padding={3}
          radius={1}
          tone="inherit"
        >
          <Flex gap={3}>
            <Box flex="none">
              {resolving ? (
                <Spinner size={1} />
              ) : count === 0 ? (
                <BannerIcon icon={InfoOutlineIcon} />
              ) : (
                <BannerIcon
                  icon={ChevronRightIcon}
                  style={{
                    transform: `rotate(${expanded ? '90deg' : 0})`,
                    transition: 'transform 100ms ease-in-out',
                  }}
                />
              )}
            </Box>
            <Box flex={1}>
              <Text size={1} weight="medium" as="div">
                {title}
              </Text>
            </Box>
          </Flex>
        </Card>
        <Flex hidden={!expanded} marginTop={1} gap={1} direction="column">
          {locations.map((location) => (
            <LocationItem key={location.href} location={location} toolName={toolName} />
          ))}
        </Flex>
      </>
    )
  }

  // Presentation's `LocationStack` in a `FormRow`: a column with 8px gaps, 20px above the form.
  return (
    <FormRow>
      <div style={{display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20}}>
        <Card padding={1} radius={2} border tone={tone}>
          <div style={{margin: -1}}>{content}</div>
        </Card>
      </div>
    </FormRow>
  )
}

/**
 * The document form's input: the banner above the form, as Presentation's. Not inside the preview
 * bar's own document panes (the Visual Editor's, the site's), which sit beside the page already;
 * they provide `PresentationDocumentContext` to hide Presentation's banner, and that hides this one.
 */
export function locationsInput(resolvers: VisualEditorLocations, toolName: string) {
  return function VisualEditorDocumentInput(props: InputProps) {
    const inPreviewBarPane = useContext(PresentationDocumentContext) !== null
    const value = props.value as {_id?: string} | undefined
    if (inPreviewBarPane || !isDocumentSchemaType(props.schemaType) || !value?._id) {
      return props.renderDefault(props)
    }
    return (
      <>
        <LocationsBanner
          id={getPublishedId(value._id)}
          version={getVersionFromId(value._id)}
          schemaType={props.schemaType}
          resolvers={resolvers}
          toolName={toolName}
        />
        {props.renderDefault(props)}
      </>
    )
  }
}
