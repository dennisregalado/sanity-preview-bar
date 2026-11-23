// The Studio's `Tooltip` wrapper (`sanity` ui-components) with its `TOOLTIP_SHARED_PROPS`:
// `padding={1}` around `Box padding={1}` + trimmed `Text size={1}`, no arrow, animated, 400ms open
// delay, and optional `Hotkeys` beside the text (as on the Studio's "Search ⌘K" button). The Studio
// places tooltips below; the bar sits at the bottom of the viewport, so they go above, with the
// Studio's fallbacks.
import {Box, Flex, Hotkeys, Text} from '@sanity/ui'
import {Tooltip} from '@sanity/ui/tooltip'
import type {JSX} from 'react'
import {useBarPlacement} from './context'

/** `GLOBAL_SEARCH_KEY_MODIFIER`: "Mod" reads as Cmd on Apple platforms and Ctrl elsewhere. */
const MOD_KEY =
  typeof window !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(window.navigator.platform)
    ? 'Cmd'
    : 'Ctrl'

export function StudioTooltip({
  content,
  hotkeys,
  disabled,
  children,
}: {
  content: string
  hotkeys?: string[]
  disabled?: boolean
  children: JSX.Element
}) {
  const place = useBarPlacement()
  return (
    <Tooltip
      portal
      animate
      arrow={false}
      boundaryElement={null}
      delay={{open: 400}}
      disabled={disabled}
      placement={place('top')}
      fallbackPlacements={[place('top-start'), place('top-end'), 'bottom-start', 'bottom-end']}
      padding={1}
      content={
        <Flex align="center">
          <Box flex={1} padding={1}>
            <Text size={1} as="div">
              {content}
            </Text>
          </Box>
          {hotkeys && (
            <Box flex="none">
              <Hotkeys keys={hotkeys.map((key) => (key === 'Mod' ? MOD_KEY : key))} />
            </Box>
          )}
        </Flex>
      }
    >
      {children}
    </Tooltip>
  )
}
