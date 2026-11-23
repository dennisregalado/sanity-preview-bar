/**
 * The Studio navbar's "Create new document" popover (`NewDocumentButton` in `sanity@6.23`, which
 * isn't exported), rebuilt from public parts inside the Studio layer: the workspace's own
 * new-document options (`source.document.resolveNewDocumentOptions`, the `newDocumentOptions`
 * config), their permissions (`useTemplatePermissions`), the Studio's `CommandList` and i18n, with
 * its sizes (320px wide, 33px rows, up to 10 shown, filtered and sorted the same way).
 *
 * Picking a type opens the new document in the bar's document pane, as Presentation opens it in
 * its editor; without the pane it opens the Studio's create intent in a new tab.
 */
import SearchIcon from '@sanity/icons/Search'
import {Box, Card, Flex, Text, TextInput, useClickOutsideEvent} from '@sanity/ui'
import {Popover} from '@sanity/ui/popover'
import {
  cloneElement,
  type ComponentType,
  createElement,
  isValidElement,
  type ReactElement,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useMemo,
  useRef,
  useState,
} from 'react'
import {useBarPlacement} from './context'

/** One new-document option (`InitialValueTemplateItem`), with its permission. */
export type NewDocumentOption = {
  id: string
  templateId: string
  schemaType: string
  title?: string
  i18n?: unknown
  icon?: ComponentType | ReactNode
  parameters?: Record<string, unknown>
  hasPermission: boolean
}

/** The parts of `sanity` the popover uses. */
export type NewDocumentSanity = {
  useSource: () => {
    document: {
      resolveNewDocumentOptions: (context: {
        type: 'global'
      }) => Array<Omit<NewDocumentOption, 'hasPermission'>>
    }
  }
  useTemplatePermissions: (options: {
    templateItems: unknown[]
  }) => [Array<{id: string; granted: boolean}> | undefined, boolean]
  useGetI18nText: (
    input: Array<Omit<NewDocumentOption, 'hasPermission'>>,
  ) => (node: {title?: string; i18n?: unknown}) => {title?: string}
  CommandList: ComponentType<{
    activeItemDataAttr?: string
    ariaLabel: string
    autoFocus?: 'input' | 'list'
    getItemDisabled?: (index: number) => boolean
    inputElement?: HTMLInputElement | null
    itemHeight: number
    items: NewDocumentOption[]
    overscan?: number
    padding?: number
    paddingBottom?: number
    renderItem: (item: NewDocumentOption) => ReactNode
  }>
}

const ITEM_HEIGHT = 33
const MAX_ITEMS = 10

/** `isQueryMatch`: every word of the query appears in the title. */
function isQueryMatch(query: string, title: string) {
  const lowercaseTitle = title.toLowerCase()
  return query
    .trim()
    .toLowerCase()
    .split(/[\s\-_]+/)
    .every((word) => lowercaseTitle.includes(word))
}

/** `sortResultRelevance`: titles starting with the query, then containing it. */
function relevance(query: string, a: string, b: string) {
  const q = query.trim().toLowerCase()
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  if (x.startsWith(q) !== y.startsWith(q)) return x.startsWith(q) ? -1 : 1
  if (x.includes(q) !== y.includes(q)) return x.includes(q) ? -1 : 1
  return 0
}

function OptionIcon({icon}: {icon: NewDocumentOption['icon']}) {
  if (!icon) return null
  // ui5's `Icon size={1}` in the Studio: the icon cloned as a 21px block with a -0.375rem margin,
  // no `Text` around it. Emoji icons (components that ignore props) inherit the row's size.
  const props = {
    'aria-hidden': true,
    style: {display: 'block', fontSize: 21, margin: '-0.375rem', color: 'var(--card-icon-color)'},
  }
  const node = isValidElement(icon)
    ? cloneElement(icon as ReactElement<Record<string, unknown>>, props)
    : typeof icon === 'function' || (typeof icon === 'object' && icon !== null)
      ? createElement(icon as ComponentType<Record<string, unknown>>, props)
      : icon
  return <Box>{node}</Box>
}

/** `NewDocumentListOption` with `preview: 'inline'`. */
function OptionItem({
  option,
  href,
  onSelect,
}: {
  option: NewDocumentOption & {title: string}
  href: string
  onSelect: (option: NewDocumentOption) => void
}) {
  const muted = option.hasPermission ? undefined : {color: 'var(--card-fg-color)'}
  const content = (
    <Flex align="center" gap={3}>
      <OptionIcon icon={option.icon} />
      <Text size={1} as="div" style={muted}>
        {option.title}
      </Text>
    </Flex>
  )
  return (
    <div>
      {option.hasPermission ? (
        <Card
          as="a"
          href={href}
          marginBottom={1}
          padding={3}
          radius={2}
          onClick={(event: MouseEvent<HTMLAnchorElement>) => {
            // Modifier clicks open the Studio's create intent (the href) in a new tab.
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
            event.preventDefault()
            onSelect(option)
          }}
        >
          {content}
        </Card>
      ) : (
        <Card as="button" disabled marginBottom={1} padding={3} radius={2}>
          {content}
        </Card>
      )}
    </div>
  )
}

export function NewDocumentMenu({
  sanity,
  studioPath,
  anchor,
  open,
  onClose,
  onSelect,
}: {
  sanity: NewDocumentSanity
  studioPath: string
  /** The bar's "+" button. */
  anchor: HTMLElement | null
  open: boolean
  onClose: () => void
  onSelect: (option: NewDocumentOption) => void
}) {
  const place = useBarPlacement()
  const source = sanity.useSource()
  const templateItems = useMemo(
    () => source.document.resolveNewDocumentOptions({type: 'global'}),
    [source],
  )
  const [permissions, loading] = sanity.useTemplatePermissions({templateItems})
  const getI18nText = sanity.useGetI18nText(templateItems)
  const [query, setQuery] = useState('')
  const [input, setInput] = useState<HTMLInputElement | null>(null)
  const popover = useRef<HTMLDivElement | null>(null)

  const options = useMemo(
    () =>
      templateItems
        .map((item) => ({
          ...item,
          title: getI18nText({...item, title: item.title || item.id}).title ?? item.id,
          hasPermission: permissions?.find((p) => p.id === item.id)?.granted ?? false,
        }))
        .sort((a, b) => a.title.localeCompare(b.title))
        .filter((option) => isQueryMatch(query, option.title))
        .sort((a, b) => relevance(query, a.title, b.title)),
    [templateItems, permissions, getI18nText, query],
  )

  function close() {
    setQuery('')
    onClose()
  }

  useClickOutsideEvent(open && close, () => [anchor, popover.current])

  const {CommandList} = sanity
  const content = (
    <Flex
      direction="column"
      style={{width: 320}}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key === 'Escape' || event.key === 'Tab') close()
      }}
    >
      <Card borderBottom padding={1} style={{minHeight: 'max-content'}}>
        <TextInput
          ref={setInput}
          __unstable_disableFocusRing
          border={false}
          fontSize={1}
          radius={1}
          icon={SearchIcon}
          placeholder="Search document types"
          disabled={loading}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </Card>
      <Flex
        direction="column"
        overflow="hidden"
        style={{
          position: 'relative',
          maxHeight: `calc(${ITEM_HEIGHT}px * ${MAX_ITEMS} + 0.5rem)`,
          minHeight: ITEM_HEIGHT,
          height: `calc(${ITEM_HEIGHT}px * ${Math.min(Math.max(options.length, 1), MAX_ITEMS)} + 0.5rem)`,
        }}
      >
        {loading ? null : options.length === 0 ? (
          <Flex align="center" justify="center" padding={4} flex={1}>
            <Text align="center" muted size={1} as="div">
              {query ? `No results for "${query}"` : 'No document types found'}
            </Text>
          </Flex>
        ) : (
          <CommandList
            activeItemDataAttr="data-hovered"
            ariaLabel="New document"
            autoFocus="input"
            getItemDisabled={(index) => !(options[index]?.hasPermission ?? true)}
            inputElement={input}
            itemHeight={ITEM_HEIGHT}
            items={options}
            overscan={5}
            padding={1}
            paddingBottom={0}
            renderItem={(option) => (
              <OptionItem
                key={option.id}
                option={option as NewDocumentOption & {title: string}}
                href={`${studioPath}/intent/create/template=${encodeURIComponent(option.templateId)};type=${encodeURIComponent(option.schemaType)}`}
                onSelect={(picked) => {
                  close()
                  onSelect(picked)
                }}
              />
            )}
          />
        )}
      </Flex>
    </Flex>
  )

  return (
    <Popover
      ref={popover}
      referenceElement={anchor}
      open={open}
      content={content}
      constrainSize
      portal
      radius={3}
      tone="default"
      placement={place('top-start')}
      fallbackPlacements={[place('top-end')]}
      zOffset={3000}
    />
  )
}
