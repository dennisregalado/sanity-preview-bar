// The Studio's global perspective switcher, rebuilt for the preview bar from `@sanity/ui`. Layout
// follows `GlobalPerspectiveButton`, `ReleasesMenu`, `ReleaseTypeMenuSection`, `ReleasesMenuItem`
// and `ReleaseAvatar` in `sanity@6.23`; behaviour (which layers show, how they stack, when the eye
// toggle appears) follows `ReleasesList`, with the shared rules in `$sanity/perspective`.
import AddIcon from '@sanity/icons/Add'
import BoltIcon from '@sanity/icons/Bolt'
import CalendarIcon from '@sanity/icons/Calendar'
import ChevronDownIcon from '@sanity/icons/ChevronDown'
import ClockIcon from '@sanity/icons/Clock'
import EyeClosedIcon from '@sanity/icons/EyeClosed'
import EyeOpenIcon from '@sanity/icons/EyeOpen'
import SearchIcon from '@sanity/icons/Search'
import {Box, Button, Card, Flex, Label, Text, TextInput} from '@sanity/ui'
import {Menu, MenuButton, MenuDivider, MenuItem} from '@sanity/ui/menu'
import {useCallback, useMemo, useRef, useState, type CSSProperties, type MouseEvent} from 'react'
import {
  BoltSmallIcon,
  CircleSmallIcon,
  ClockSmallIcon,
  RingIcon,
  UnknownSmallIcon,
} from './layer-icons'
import {StudioMenuItem} from './StudioMenuItem'
import {StudioTooltip} from './StudioTooltip'
import {
  DRAFTS,
  PUBLISHED,
  RELEASE_TYPES,
  isScheduledDraft,
  perspectiveStack,
  releaseIdOf,
  releaseTone,
  selectionOf,
  type PreviewPerspective,
  type ReleaseDocument,
  type ReleaseType,
} from '../core/perspective'
import {useBarData, useBarPlacement} from './context'

const GROUP_LABELS: Record<ReleaseType, string> = {
  asap: 'ASAP',
  scheduled: 'At time',
  undecided: 'Undecided',
}
const UNTITLED = 'Untitled release'
/** `ReleasesMenuItemIndicator` geometry: the stack line sits 20px from the row's left edge, meets
 *  each icon 16.5px down, starts 3px above that on the first row, and bridges the 4px row gap. */
const LINE_LEFT = 20
const LINE_IN_RANGE_HEIGHT = 16.5
const LINE_BOTTOM = 4

type Layer =
  | {kind: 'published'; id: string; title: string}
  | {kind: 'drafts'; id: string; title: string}
  | {kind: 'release'; id: string; title: string; release: ReleaseDocument}

export type PerspectiveMenuProps = {
  releases: ReleaseDocument[]
  releasesError: boolean
  perspective: PreviewPerspective
  onOpenChange: (open: boolean) => void
  /** Switches to a selection (`usePerspectiveSwitch`). */
  onSelect: (next: PerspectiveSelection) => void
}

/** A menu selection: the chosen layer and the layers hidden with the eye toggle. */
export type PerspectiveSelection = {selected: string; excluded: string[]}

/**
 * Switching perspective, for the menu and for the document pane's Published / Draft chips.
 * Optimistic: the bar shows the new stack (chip, dots, stack lines, tone) at once, built with the
 * same `perspectiveStack` the endpoint uses. The cookie is stored in the background, then the host
 * reruns the page's queries in place. Switches save one after another, so the cookie always ends
 * on the last one; only the latest refreshes, and a failed one puts the bar back.
 */
export function usePerspectiveSwitch({
  basePath,
  releases,
  perspective,
  onChange,
  onRefresh,
}: {
  basePath: string
  releases: ReleaseDocument[]
  perspective: PreviewPerspective
  /** Shows a stack in the bar: the optimistic one, then the server's, or the old one on failure. */
  onChange: (perspective: PreviewPerspective) => void
  /** Reruns the storefront's queries once the server has stored the latest switch. */
  onRefresh: () => Promise<void>
}) {
  const saves = useRef<Promise<void>>(Promise.resolve())
  const latest = useRef(0)
  const current = useRef({perspective, releases, onChange, onRefresh})
  current.current = {perspective, releases, onChange, onRefresh}

  return useCallback(
    (next: PerspectiveSelection) => {
      const {perspective: previous, releases: list, onChange: show} = current.current
      const request = ++latest.current
      show(perspectiveStack({selected: next.selected, releases: list, excluded: next.excluded}))

      saves.current = saves.current.then(async () => {
        try {
          const response = await fetch(`${basePath}/perspective`, {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify(next),
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const {perspective: stored} = (await response.json()) as {
            perspective: PreviewPerspective
          }
          if (request !== latest.current) return
          // The server builds the stack from fresh release data; it wins if a release changed.
          current.current.onChange(stored)
          await current.current.onRefresh()
        } catch (err) {
          console.error('Preview bar: could not change perspective', err)
          if (request === latest.current) current.current.onChange(previous)
        }
      })
    },
    [basePath],
  )
}

/** "Monday at 2:00 AM" within a week, "Dec 1 at 2:00 AM" (plus year if not this year) after. */
function formatPublishDate(value: string) {
  const date = new Date(value)
  const now = new Date()
  const time = date.toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'})
  const days = (date.getTime() - now.getTime()) / 86_400_000
  const day =
    days >= 0 && days < 7
      ? date.toLocaleDateString(undefined, {weekday: 'long'})
      : date.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          ...(date.getFullYear() === now.getFullYear() ? {} : {year: 'numeric'}),
        })
  return `${day} at ${time}`
}

function layerTone(layer: Layer) {
  if (layer.kind === 'published') return 'positive'
  if (layer.kind === 'drafts') return 'caution'
  return releaseTone(layer.release)
}

/**
 * `ReleaseAvatarIcon`. In the menu it is the Studio's small icon at `fontSize={2}` (ring for drafts,
 * dot for published, bolt/clock/unknown by release type), tinted `--card-badge-<tone>-icon-color`.
 * The switcher button keeps its own approved icon.
 */
function LayerIcon({layer, variant = 'chip'}: {layer: Layer; variant?: 'chip' | 'menu'}) {
  const color = `var(--card-badge-${layerTone(layer)}-icon-color)`
  const type = layer.kind === 'release' ? layer.release.metadata.releaseType : undefined
  if (variant === 'menu') {
    let small
    if (layer.kind === 'published') small = <CircleSmallIcon />
    else if (layer.kind === 'drafts') small = <RingIcon />
    else if (type === 'asap') small = <BoltSmallIcon />
    else if (type === 'scheduled') small = <ClockSmallIcon />
    else small = <UnknownSmallIcon />
    // Sanity UI's `Text` colours `[data-sanity-icon]` with `--card-icon-color`; set that, as
    // `ReleaseAvatarIcon` does, rather than `color`.
    return (
      <Text size={2} style={{'--card-icon-color': color} as CSSProperties}>
        {small}
      </Text>
    )
  }
  let icon
  if (type === 'asap') icon = <BoltIcon />
  else if (type === 'scheduled') icon = <ClockIcon />
  else
    icon = (
      <svg width="1em" height="1em" viewBox="0 0 25 25" fill="none" aria-hidden="true">
        {layer.kind === 'drafts' ? (
          <circle cx="12.5" cy="12.5" r="3.25" stroke="currentColor" strokeWidth="1.5" />
        ) : (
          <circle cx="12.5" cy="12.5" r="4" fill="currentColor" />
        )}
      </svg>
    )
  return (
    <Text size={1} style={{color}}>
      {icon}
    </Text>
  )
}

/** The stack line through the layers that make up the current perspective. */
function RangeLine({position}: {position: 'first' | 'within' | 'last' | undefined}) {
  if (!position) return null
  return (
    <span
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: LINE_LEFT,
        width: 1,
        top: position === 'first' ? LINE_IN_RANGE_HEIGHT - 3 : 0,
        bottom: position === 'last' ? `calc(100% - ${LINE_IN_RANGE_HEIGHT}px)` : -LINE_BOTTOM,
        background: 'var(--card-border-color)',
        pointerEvents: 'none',
        zIndex: 1,
      }}
    />
  )
}

export function PerspectiveMenu({
  releases,
  releasesError,
  perspective,
  onOpenChange,
  onSelect,
}: PerspectiveMenuProps) {
  const {basePath, studioPath} = useBarData()
  const place = useBarPlacement()
  const [filter, setFilter] = useState('')
  const {selected, excluded} = useMemo(
    () => selectionOf(perspective, releases),
    [perspective, releases],
  )

  // Menu order: published, drafts, then ASAP → at time → undecided, without Scheduled Drafts.
  const layers = useMemo<Layer[]>(() => {
    const listed = releases.filter((release) => !isScheduledDraft(release))
    return [
      {kind: 'published', id: PUBLISHED, title: 'Published'},
      {kind: 'drafts', id: DRAFTS, title: 'Drafts'},
      ...RELEASE_TYPES.flatMap((type) =>
        listed
          .filter((release) => release.metadata.releaseType === type)
          .map((release) => ({
            kind: 'release' as const,
            id: releaseIdOf(release),
            title: release.metadata.title || UNTITLED,
            release,
          })),
      ),
    ]
  }, [releases])

  const query = filter.trim().toLowerCase()
  const visible = query
    ? layers.filter((layer) => layer.title.toLowerCase().includes(query))
    : layers
  const selectedLayer = layers.find((layer) => layer.id === selected) ?? layers[1]
  const lastIndex = selected === PUBLISHED ? 0 : layers.indexOf(selectedLayer)

  function rangePosition(index: number) {
    if (query || lastIndex === 0) return undefined
    if (index === 0) return 'first' as const
    if (index === lastIndex) return 'last' as const
    return index < lastIndex ? ('within' as const) : undefined
  }

  /** `ReleasesMenuItem`'s `canReleaseBeExcluded`. */
  function canExclude(layer: Layer, index: number) {
    if (layer.kind === 'published') return false
    if (layer.kind === 'drafts') return selectedLayer.kind === 'release'
    if (layer.release.metadata.releaseType === 'scheduled') return false
    const position = rangePosition(index)
    return position === 'first' || position === 'within'
  }

  function apply(next: PerspectiveSelection) {
    onSelect(next)
  }

  function toggleExcluded(event: MouseEvent, id: string) {
    event.preventDefault()
    event.stopPropagation()
    const nextExcluded = excluded.includes(id)
      ? excluded.filter((name) => name !== id)
      : [...excluded, id]
    apply({selected, excluded: nextExcluded})
  }

  function renderLayer(layer: Layer) {
    const index = layers.indexOf(layer)
    const active = layer.id === selectedLayer.id
    const hidden = selectedLayer.kind === 'release' && excluded.includes(layer.id)
    const publishAt =
      layer.kind === 'release' && layer.release.metadata.releaseType === 'scheduled'
        ? layer.release.publishAt || layer.release.metadata.intendedPublishAt
        : null
    return (
      <Box key={layer.id} style={{position: 'relative'}}>
        <RangeLine position={rangePosition(index)} />
        <MenuItem
          selected={active}
          padding={1}
          onClick={() => {
            if (!active) apply({selected: layer.id, excluded})
          }}
        >
          <Flex align="flex-start" gap={1} style={{opacity: hidden ? 0.5 : 1}}>
            {/* `ReleaseAvatar`: paddingX 3 / paddingY 2 on the row's own background, which hides the
						    stack line behind the icon like the Studio does. */}
            <Flex
              flex="none"
              paddingX={3}
              paddingY={2}
              style={{
                borderRadius: 3,
                position: 'relative',
                zIndex: 2,
                background: 'var(--card-bg-color)',
              }}
            >
              <LayerIcon layer={layer} variant="menu" />
            </Flex>
            <Flex
              direction="column"
              flex={1}
              gap={2}
              paddingY={2}
              paddingRight={2}
              style={{minWidth: 0}}
            >
              <Text
                size={1}
                weight="medium"
                textOverflow="ellipsis"
                style={{minWidth: 0, color: 'inherit'}}
              >
                {layer.title}
              </Text>
              {publishAt && (
                <Text size={1} muted style={{color: 'inherit', opacity: 0.75}}>
                  {formatPublishDate(publishAt)}
                </Text>
              )}
            </Flex>
            {canExclude(layer, index) && (
              <Box flex="none" padding={1}>
                <StudioTooltip content={hidden ? 'Show release' : 'Hide release'}>
                  <Button
                    as="span"
                    mode="bleed"
                    padding={2}
                    radius="full"
                    fontSize={1}
                    icon={hidden ? EyeClosedIcon : EyeOpenIcon}
                    aria-label={hidden ? 'Show release' : 'Hide release'}
                    onClick={(event: MouseEvent) => toggleExcluded(event, layer.id)}
                  />
                </StudioTooltip>
              </Box>
            )}
          </Flex>
        </MenuItem>
      </Box>
    )
  }

  const systemLayers = visible.filter((layer) => layer.kind !== 'release')
  const groups = RELEASE_TYPES.map((type) => ({
    type,
    items: visible.filter(
      (layer) => layer.kind === 'release' && layer.release.metadata.releaseType === type,
    ),
  })).filter((group) => group.items.length > 0)

  // `ReleasesNavContainer`: a bordered pill (2px padding and gap, -3px block margin so it keeps the
  // bar's button height) with `CurrentGlobalPerspectiveLabel`, then the round chevron menu button.
  return (
    <Card
      border
      radius="full"
      tone="inherit"
      flex="none"
      style={{display: 'flex', alignItems: 'center', gap: 2, padding: 2, margin: '-3px 0'}}
    >
      <Box padding={2} style={{userSelect: 'none', overflow: 'hidden'}}>
        <Flex align="center" gap={2}>
          <LayerIcon layer={selectedLayer} />
          <Text size={1} weight="medium" textOverflow="ellipsis">
            {selectedLayer.title}
          </Text>
        </Flex>
      </Box>
      <MenuButton
        id="preview-perspective"
        onOpen={() => onOpenChange(true)}
        onClose={() => {
          setFilter('')
          onOpenChange(false)
        }}
        popover={{
          animate: true,
          placement: place('top-start'),
          fallbackPlacements: [place('top-end')],
          portal: true,
          constrainSize: true,
          tone: 'default',
          zOffset: 3000,
        }}
        button={
          <Button
            mode="bleed"
            padding={2}
            radius="full"
            iconRight={ChevronDownIcon}
            aria-label={`Perspective: ${selectedLayer.title}`}
          />
        }
        menu={
          // The Studio locks the menu to its measured natural width. Row titles truncate, so
          // their min-content is ~0 and the popover would shrink to a sliver; pin the native
          // menu's footprint instead.
          <Menu padding={0} style={{width: 280, maxWidth: 'calc(100vw - 16px)'}}>
            <Box padding={2} style={{borderBottom: '1px solid var(--card-border-color)'}}>
              <TextInput
                fontSize={1}
                radius={2}
                icon={SearchIcon}
                placeholder="Find a version or release"
                value={filter}
                onChange={(event) => setFilter(event.currentTarget.value)}
                onKeyDown={(event) => event.stopPropagation()}
              />
            </Box>
            {/* `ReleasesList`: Card padding 1 with a 4px gap between rows. */}
            <Flex direction="column" gap={1} padding={1}>
              {systemLayers.map(renderLayer)}
              {groups.map((group) => {
                const offset = layers.indexOf(group.items[0])
                const withinStack = !query && offset > 0 && lastIndex >= offset
                return (
                  <Box key={group.type}>
                    <Box
                      paddingTop={3}
                      paddingBottom={1}
                      style={{position: 'relative', paddingLeft: 41}}
                    >
                      <RangeLine position={withinStack ? 'within' : undefined} />
                      <Label muted size={1}>
                        {GROUP_LABELS[group.type]}
                      </Label>
                    </Box>
                    {group.items.map(renderLayer)}
                  </Box>
                )
              })}
              {releasesError && (
                <Box padding={3}>
                  <Text size={1} muted>
                    Couldn’t load content releases.
                  </Text>
                </Box>
              )}
            </Flex>
            <MenuDivider />
            {/* Footer links: the Studio's own MenuItem wrapper (paddingX 3, paddingY 3) in a
							    column with a 4px gap. */}
            <Flex direction="column" gap={1} padding={1}>
              <StudioMenuItem
                href={`${studioPath}/intent/releases-scheduled-drafts/view=drafts/`}
                icon={CalendarIcon}
                text="View Scheduled Drafts"
              />
              <StudioMenuItem
                href={`${studioPath}/intent/release/`}
                icon={CalendarIcon}
                text="View Content Releases"
              />
              <StudioMenuItem
                href={`${studioPath}/intent/release/`}
                icon={AddIcon}
                text="New release"
              />
            </Flex>
          </Menu>
        }
      />
    </Card>
  )
}

/** Studio URL search params that carry this perspective into the Visual Editor. */
export function studioPerspectiveParams(
  perspective: PreviewPerspective,
  releases: ReleaseDocument[],
) {
  const {selected, excluded} = selectionOf(perspective, releases)
  const params = new URLSearchParams()
  if (selected !== DRAFTS) params.set('perspective', selected)
  if (excluded.length) params.set('excludedPerspectives', excluded.join(','))
  return params
}
