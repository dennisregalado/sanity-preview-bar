// The Studio's global search (`SearchPopover`), rebuilt on `@sanity/ui` for the preview bar and
// limited to what the link picker can point at. Layout follows `sanity@6.23`:
// - a backdrop, then a `Card radius={3} shadow={2}` centred 12vh from the top,
//   `min(100vw - 40px, 800px)` wide, at most `min(88vh - 20px, 735px)` tall (less the bar);
// - `SearchHeader`: a borderless `TextInput`, `fontSize={1}`, no focus ring (search icon, spinning
//   icon while loading, clear button);
// - `Filters`: the type button ("All types", or the chosen types' titles) and "Clear filters";
// - with a query only: the sort menu (Best match, Created, Updated) and results, or `NoResults`;
// - `SearchResults`: a `CommandList`-style virtual list (`@tanstack/react-virtual`, the same library
//   the link picker uses), `paddingX={2}` / `paddingY={1}`, rows `paddingY={1}`;
// - `SearchResultItem` rows: `SanityDefaultPreview` (33px media or the type icon, title, subtitle)
//   with the type badge and the document status icon.
// Results come from the bar's `/search` endpoint, which mirrors the Studio's `groq2024` query.
import CheckmarkIcon from '@sanity/icons/Checkmark'
import ChevronDownIcon from '@sanity/icons/ChevronDown'
import SearchIcon from '@sanity/icons/Search'
import SortIcon from '@sanity/icons/Sort'
import SpinnerIcon from '@sanity/icons/Spinner'
import {Badge, Box, Button, Card, Flex, Text, TextInput} from '@sanity/ui'
import {Menu, MenuButton, MenuDivider, MenuItem} from '@sanity/ui/menu'
import {useVirtualizer} from '@tanstack/react-virtual'
import {motion, type Transition, type Variants} from 'motion/react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react'
import {
  type SearchKind,
  type SearchKindOption,
  type SearchResult,
  type SearchSort,
} from '../core/link-search'
import {PREVIEW_BAR_HEIGHT} from '../core/protocol'
import {useBarData} from './context'
import {CircleSmallIcon, ClockSmallIcon, RingIcon} from './layer-icons'

const SORT_LABELS: Record<SearchSort, string> = {
  best: 'Best match',
  createdAsc: 'Created: Oldest first',
  createdDesc: 'Created: Newest first',
  updatedAsc: 'Updated: Oldest first',
  updatedDesc: 'Updated: Newest first',
}
const STATUS_TONES = {published: 'positive', draft: 'caution', version: 'suggest'} as const
const ROW_ESTIMATE = 57

// `SearchPopover`'s motion: the backdrop fades and the card fades and settles from 99% on a 0.4s
// spring, in and out (the bar wraps the dialog in `AnimatePresence`).
const ANIMATION_TRANSITION: Transition = {duration: 0.4, type: 'spring'}
const CARD_VARIANTS: Variants = {
  open: {opacity: 1, scale: 1, x: '-50%'},
  closed: {opacity: 0, scale: 0.99, x: '-50%'},
}
const OVERLAY_VARIANTS: Variants = {open: {opacity: 1}, closed: {opacity: 0}}
const MotionCard = motion.create(Card)
const DEBOUNCE_MS = 150

type Props = {
  kinds: SearchKindOption[]
  onClose: () => void
  onSelect: (href: string) => void
}

type ResultsState = {
  results: SearchResult[]
  nextOffset: number | null
  loading: boolean
  error: boolean
}

/**
 * `SanityDefaultPreview`'s media slot (`Media`): 33px, radius 1, an inset hairline over an image or
 * the type's icon, images `object-fit: contain`.
 */
function Media({result}: {result: SearchResult}) {
  return (
    <span
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 'none',
        width: 33,
        height: 33,
        borderRadius: 3,
        overflow: 'hidden',
      }}
    >
      {result.image ? (
        <img
          src={result.image}
          alt=""
          loading="lazy"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'contain',
          }}
        />
      ) : (
        <Text size={1}>{result.emoji}</Text>
      )}
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          boxShadow: 'inset 0 0 0 1px var(--card-fg-color)',
          opacity: 0.1,
          borderRadius: 'inherit',
        }}
      />
    </span>
  )
}

/**
 * `DocumentVersionsStatusIndicator`: one small layer icon per version that exists (draft ring,
 * published dot, release clock), tinted through `--card-icon-color`.
 */
function StatusIcons({status}: {status: SearchResult['status']}) {
  if (status.length === 0) return null
  return (
    <Flex align="center">
      {status.map((kind) => (
        <Text
          key={kind}
          size={2}
          style={
            {
              '--card-icon-color': `var(--card-badge-${STATUS_TONES[kind]}-icon-color)`,
            } as CSSProperties
          }
        >
          {kind === 'published' ? (
            <CircleSmallIcon />
          ) : kind === 'draft' ? (
            <RingIcon />
          ) : (
            <ClockSmallIcon />
          )}
        </Text>
      ))}
    </Flex>
  )
}

/** The Studio's `AnimatedSpinnerIcon`: the same box as the search icon, so the input doesn't shift. */
function LoadingIcon() {
  return <SpinnerIcon className="preview-bar-spinner" />
}

/** `NoResults`. */
function NoResults({failed}: {failed: boolean}) {
  return (
    <Flex direction="column" align="center" gap={4} paddingX={4} paddingY={5}>
      <Text size={1} weight="medium" muted align="center">
        {failed ? 'Search failed' : 'No results found'}
      </Text>
      <Text size={1} muted align="center">
        {failed ? 'Try again in a moment' : 'Try another keyword or adjust your filters'}
      </Text>
    </Flex>
  )
}

function ResultRow({
  result,
  active,
  onSelect,
  onHover,
}: {
  result: SearchResult
  active: boolean
  onSelect: () => void
  onHover: () => void
}) {
  return (
    <Card
      as="button"
      type="button"
      radius={2}
      tabIndex={-1}
      data-active={active ? '' : undefined}
      className="preview-search-row"
      onClick={onSelect}
      onMouseMove={onHover}
      style={{width: '100%', textAlign: 'left'}}
    >
      {/* `SanityDefaultPreview`, default layout: 8px around the 33px media, so rows are 57px. */}
      <Flex align="center" gap={2} padding={2}>
        <Media result={result} />
        <Flex direction="column" flex={1} gap={2} style={{minWidth: 0}}>
          <Text size={1} weight="medium" textOverflow="ellipsis">
            {result.title}
          </Text>
          {result.subtitle && (
            <Text size={1} muted textOverflow="ellipsis">
              {result.subtitle}
            </Text>
          )}
        </Flex>
        <Flex align="center" gap={3} flex="none">
          <Badge>{result.badge}</Badge>
          <StatusIcons status={result.status} />
        </Flex>
      </Flex>
    </Card>
  )
}

export function SearchDialog({kinds: options, onClose, onSelect}: Props) {
  const {basePath} = useBarData()
  // Schema type titles, as the Studio's type button and list use them.
  const labels = useMemo(
    () => Object.fromEntries(options.map((option) => [option.kind, option.title])),
    [options],
  )
  const [query, setQuery] = useState('')
  const [kinds, setKinds] = useState<SearchKind[]>([])
  const [sort, setSort] = useState<SearchSort>('best')
  const [state, setState] = useState<ResultsState>({
    results: [],
    nextOffset: null,
    loading: false,
    error: false,
  })
  const hasQuery = query.trim().length > 0
  const [active, setActive] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const requestRef = useRef<AbortController | null>(null)

  const params = useMemo(() => {
    const search = new URLSearchParams({q: query.trim(), sort})
    if (kinds.length) search.set('kinds', kinds.join(','))
    return search
  }, [query, kinds, sort])

  const load = useCallback(
    async (offset: number) => {
      requestRef.current?.abort()
      const controller = new AbortController()
      requestRef.current = controller
      setState((current) => ({...current, loading: true, error: false}))
      try {
        const search = new URLSearchParams(params)
        search.set('offset', String(offset))
        const response = await fetch(`${basePath}/search?${search}`, {
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = (await response.json()) as {
          results: SearchResult[]
          nextOffset: number | null
        }
        setState((current) => ({
          results: offset === 0 ? data.results : [...current.results, ...data.results],
          nextOffset: data.nextOffset,
          loading: false,
          error: false,
        }))
        if (offset === 0) setActive(0)
      } catch (err) {
        if (controller.signal.aborted) return
        console.error('Preview bar: search failed', err)
        setState((current) => ({...current, loading: false, error: true}))
      }
    },
    [params],
  )

  // Debounced fresh search whenever the query, types or sort change. Like the Studio, nothing is
  // listed until there's a query.
  useEffect(() => {
    if (!hasQuery) {
      requestRef.current?.abort()
      setState({results: [], nextOffset: null, loading: false, error: false})
      return
    }
    const timer = window.setTimeout(() => void load(0), DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [load, hasQuery])
  useEffect(() => () => requestRef.current?.abort(), [])

  const {results, nextOffset, loading} = state
  const virtualizer = useVirtualizer({
    count: results.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE,
    overscan: 4,
  })
  const items = virtualizer.getVirtualItems()
  const lastItem = items[items.length - 1]

  // Load the next page as the list nears its end, like the Studio's `onEndReached`.
  useEffect(() => {
    if (!lastItem || loading || nextOffset === null) return
    if (lastItem.index >= results.length - 1 - 4) void load(nextOffset)
  }, [lastItem, loading, nextOffset, results.length, load])

  function select(index: number) {
    const result = results[index]
    if (result) onSelect(result.href)
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      // Functional update: fast repeats each move one row, not one row per render.
      setActive((current) => {
        const next = Math.max(0, Math.min(results.length - 1, current + step))
        virtualizer.scrollToIndex(next, {align: 'auto'})
        return next
      })
    } else if (event.key === 'Enter') {
      event.preventDefault()
      select(active)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  function toggleKind(kind: SearchKind) {
    setKinds((current) =>
      current.includes(kind) ? current.filter((value) => value !== kind) : [...current, kind],
    )
  }

  // `DocumentTypesButton`: "All types", or the chosen types' titles.
  const typesLabel =
    kinds.length === 0 ? 'All types' : kinds.map((kind) => labels[kind] ?? kind).join(', ')

  return (
    <>
      {/* `MotionOverlay`: the Studio's backdrop; a click outside the card closes search. */}
      <motion.div
        aria-hidden="true"
        onMouseDown={onClose}
        initial="closed"
        animate="open"
        exit="closed"
        variants={OVERLAY_VARIANTS}
        transition={ANIMATION_TRANSITION}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(227, 228, 232, 0.5)',
        }}
      />
      <MotionCard
        initial="closed"
        animate="open"
        exit="closed"
        variants={CARD_VARIANTS}
        transition={ANIMATION_TRANSITION}
        radius={3}
        shadow={2}
        overflow="hidden"
        role="dialog"
        aria-label="Search"
        onKeyDown={handleKeyDown}
        style={{
          position: 'fixed',
          top: '12vh',
          left: '50%',
          width: 'min(calc(100vw - 40px), 800px)',
          // The Studio's limit, less the bar so the card never covers it.
          maxHeight: `min(calc(88vh - 20px - ${PREVIEW_BAR_HEIGHT}px), 735px)`,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Box padding={1} flex="none">
          <TextInput
            autoFocus
            border={false}
            __unstable_disableFocusRing
            fontSize={1}
            radius={2}
            icon={loading ? LoadingIcon : SearchIcon}
            clearButton={query.length > 0}
            onClear={() => setQuery('')}
            placeholder="Search"
            aria-label="Search"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </Box>
        {/* `Filters`: the type button on the left, "Clear filters" on the right once set. */}
        <Card borderTop flex="none">
          <Flex align="flex-start" justify="space-between" gap={3} padding={2}>
            <MenuButton
              id="preview-search-types"
              popover={{
                animate: true,
                placement: 'bottom-start',
                portal: true,
                tone: 'default',
                zOffset: 3000,
              }}
              button={
                <Button
                  mode="ghost"
                  padding={2}
                  fontSize={1}
                  text={typesLabel}
                  iconRight={ChevronDownIcon}
                />
              }
              menu={
                <Menu padding={1}>
                  {options.map(({kind}) => (
                    <MenuItem
                      key={kind}
                      fontSize={1}
                      padding={3}
                      text={labels[kind]}
                      iconRight={kinds.includes(kind) ? CheckmarkIcon : undefined}
                      pressed={kinds.includes(kind)}
                      onClick={() => toggleKind(kind)}
                    />
                  ))}
                </Menu>
              }
            />
            {kinds.length > 0 && (
              <Button
                mode="bleed"
                tone="critical"
                padding={2}
                fontSize={1}
                text="Clear filters"
                onClick={() => setKinds([])}
              />
            )}
          </Flex>
        </Card>
        {hasQuery && (
          <>
            {results.length > 0 && (
              <Card borderTop flex="none">
                <Flex padding={2}>
                  <MenuButton
                    id="preview-search-sort"
                    popover={{
                      animate: true,
                      placement: 'bottom-start',
                      portal: true,
                      tone: 'default',
                      zOffset: 3000,
                    }}
                    button={
                      <Button
                        mode="bleed"
                        padding={2}
                        fontSize={1}
                        icon={SortIcon}
                        text={SORT_LABELS[sort]}
                      />
                    }
                    menu={
                      <Menu padding={1}>
                        {(Object.keys(SORT_LABELS) as SearchSort[]).map((key, index) => (
                          <Box key={key}>
                            {(index === 1 || index === 3) && <MenuDivider />}
                            <MenuItem
                              fontSize={1}
                              padding={3}
                              text={SORT_LABELS[key]}
                              pressed={sort === key}
                              onClick={() => setSort(key)}
                            />
                          </Box>
                        ))}
                      </Menu>
                    }
                  />
                </Flex>
              </Card>
            )}
            <Card
              borderTop
              flex={1}
              style={{minHeight: 0, display: 'flex', flexDirection: 'column'}}
            >
              {results.length === 0 && !loading ? (
                <NoResults failed={state.error} />
              ) : (
                <div
                  ref={scrollRef}
                  role="listbox"
                  aria-label="Search results"
                  style={{overflowY: 'auto', flex: 1, minHeight: 0}}
                >
                  <div
                    style={{
                      position: 'relative',
                      height: virtualizer.getTotalSize() + 8,
                      margin: '0 8px',
                    }}
                  >
                    {items.map((item) => (
                      <div
                        key={results[item.index].key}
                        data-index={item.index}
                        ref={virtualizer.measureElement}
                        style={{
                          position: 'absolute',
                          top: 4,
                          left: 0,
                          right: 0,
                          transform: `translateY(${item.start}px)`,
                          padding: '4px 0',
                        }}
                      >
                        <ResultRow
                          result={results[item.index]}
                          active={item.index === active}
                          onSelect={() => select(item.index)}
                          onHover={() => setActive(item.index)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          </>
        )}
      </MotionCard>
    </>
  )
}
