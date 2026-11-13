// The Studio's own `MenuItem` wrapper (`sanity` ui-components), rebuilt on `@sanity/ui`:
// `paddingX={3}` / `paddingY={3}`, a 25px icon pulled in by -6px / -8px margins inside a
// `paddingRight={1}` box, `gap={2}`, then the title (size 1, medium, `--card-fg-color`).
import {Box, Flex, Text} from '@sanity/ui'
import {MenuItem} from '@sanity/ui/menu'
import type {ComponentType} from 'react'

type Props = {
  icon: ComponentType
  text: string
  /** Renders a link opened in a new tab. */
  href?: string
  onClick?: () => void
  disabled?: boolean
}

export function StudioMenuItem({icon: IconComponent, text, href, onClick, disabled}: Props) {
  const content = (
    <Flex align="center" gap={2}>
      <Box paddingRight={1}>
        <span
          style={{
            display: 'flex',
            fontSize: 25,
            marginInline: '-0.375rem',
            marginBlock: '-0.5rem',
            color: 'var(--card-icon-color)',
          }}
        >
          <IconComponent />
        </span>
      </Box>
      <Flex direction="column" flex={1} style={{minWidth: 0}}>
        <Text
          size={1}
          weight="medium"
          textOverflow="ellipsis"
          style={{color: 'var(--card-fg-color)'}}
        >
          {text}
        </Text>
      </Flex>
    </Flex>
  )
  if (href) {
    return (
      <MenuItem as="a" href={href} target="_blank" rel="noopener" paddingX={3} paddingY={3}>
        {content}
      </MenuItem>
    )
  }
  return (
    <MenuItem onClick={onClick} disabled={disabled} paddingX={3} paddingY={3}>
      {content}
    </MenuItem>
  )
}
