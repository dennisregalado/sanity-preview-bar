/**
 * The Visual Editor's page picker, beside the perspective switcher in the middle of the bar, like
 * the page menu in Shopify's theme editor, and drawn like the switcher: a bordered pill with the
 * current page, then a round chevron button. The page shows its document's schema type icon and
 * live preview title (as the Studio previews it), or its path; either opens the bar's search
 * to go to another page.
 */
import ChevronDownIcon from '@sanity/icons/ChevronDown'
import DocumentIcon from '@sanity/icons/Document'
import HomeIcon from '@sanity/icons/Home'
import {Box, Button, Card, Flex, Text} from '@sanity/ui'
import {
  type ComponentType,
  createElement,
  isValidElement,
  type ReactNode,
  useEffect,
  useState,
} from 'react'
import {StudioTooltip} from './StudioTooltip'

type PreviewModule = {
  useSchema: () => {get: (name: string) => {icon?: unknown; title?: string} | undefined}
  useDocumentPreviewStore: () => {
    observeForPreview: (
      value: {_id: string; _type: string},
      schemaType: unknown,
    ) => {
      subscribe: (next: (result: {snapshot?: {title?: unknown} | null}) => void) => {
        unsubscribe: () => void
      }
    }
  }
}

/** The switcher's label row: a size-1 icon, then the medium size-1 title. */
function PageRow({icon, title}: {icon: ReactNode; title: string}) {
  return (
    <Flex align="center" gap={2}>
      <Text size={1}>{icon}</Text>
      <Text size={1} weight="medium" textOverflow="ellipsis">
        {title}
      </Text>
    </Flex>
  )
}

/** A schema type's icon (a component, an element or an emoji), as the Studio draws it. */
function TypeIcon({icon}: {icon: unknown}) {
  if (isValidElement(icon)) return icon
  if (typeof icon === 'function' || (typeof icon === 'object' && icon !== null))
    return createElement(icon as ComponentType)
  return <DocumentIcon />
}

/**
 * The page's document as the Studio previews it (inside a running Studio only): its schema type's
 * own icon and its live preview title, drawn in the switcher's row rather than the Studio's
 * `Preview` layout, whose padding would make the pill taller than the switcher.
 */
export function NativePagePreview({
  sanity,
  document,
  fallback,
}: {
  sanity: unknown
  document: {id: string; type: string}
  fallback: string
}) {
  const {useSchema, useDocumentPreviewStore} = sanity as PreviewModule
  const schemaType = useSchema().get(document.type)
  const previewStore = useDocumentPreviewStore()
  const [title, setTitle] = useState<string | null>(null)
  useEffect(() => {
    setTitle(null)
    if (!schemaType) return
    const subscription = previewStore
      .observeForPreview({_id: document.id, _type: document.type}, schemaType)
      .subscribe(({snapshot}) => {
        setTitle(typeof snapshot?.title === 'string' ? snapshot.title : null)
      })
    return () => subscription.unsubscribe()
  }, [previewStore, schemaType, document.id, document.type])
  return (
    <PageRow
      icon={<TypeIcon icon={schemaType?.icon} />}
      title={title ?? schemaType?.title ?? fallback}
    />
  )
}

/** The page picker's fallback label: home or the path. */
export function pageFallbackTitle(path: string | null) {
  const home = path === null || path === '/' || path.startsWith('/?')
  return home ? 'Home page' : (path ?? '/')
}

export function PagePicker({
  preview,
  path,
  onOpen,
  onHoverChange,
}: {
  /** The page document's preview, when the page has one. */
  preview: ReactNode
  path: string | null
  onOpen: () => void
  onHoverChange: (hovered: boolean) => void
}) {
  const home = path === null || path === '/' || path.startsWith('/?')
  return (
    <span
      style={{display: 'flex', minWidth: 0}}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      onFocus={() => onHoverChange(true)}
      onBlur={() => onHoverChange(false)}
    >
      <StudioTooltip content="Go to page" hotkeys={['Mod', 'K']}>
        {/* The switcher's `ReleasesNavContainer` pill: 2px padding and gap, -3px block margin. */}
        <Card
          border
          radius="full"
          tone="inherit"
          flex="none"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            padding: 2,
            margin: '-3px 0',
            maxWidth: 260,
            minWidth: 0,
          }}
        >
          <Box
            padding={2}
            role="button"
            tabIndex={-1}
            onClick={onOpen}
            style={{userSelect: 'none', overflow: 'hidden', minWidth: 0, cursor: 'pointer'}}
          >
            {preview ?? (
              <PageRow
                icon={home ? <HomeIcon /> : <DocumentIcon />}
                title={pageFallbackTitle(path)}
              />
            )}
          </Box>
          <Button
            mode="bleed"
            padding={2}
            radius="full"
            iconRight={ChevronDownIcon}
            aria-label="Go to another page"
            onClick={onOpen}
          />
        </Card>
      </StudioTooltip>
    </span>
  )
}
