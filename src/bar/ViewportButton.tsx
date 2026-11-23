/**
 * Presentation's viewport toggle, for the Visual Editor tool: desktop width or a 375px phone. The
 * tool animates the site's frame between the two.
 */
import DesktopIcon from '@sanity/icons/Desktop'
import MobileDeviceIcon from '@sanity/icons/MobileDevice'
import {Button} from '@sanity/ui'
import {useState} from 'react'
import {StudioTooltip} from './StudioTooltip'

export function ViewportButton({
  onChange,
  onHoverChange,
}: {
  onChange: (mode: 'desktop' | 'mobile') => void
  onHoverChange: (hovered: boolean) => void
}) {
  const [mode, setMode] = useState<'desktop' | 'mobile'>('desktop')
  const label = mode === 'desktop' ? 'Switch to narrow viewport' : 'Switch to full viewport'
  return (
    <span
      style={{display: 'flex'}}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      onFocus={() => onHoverChange(true)}
      onBlur={() => onHoverChange(false)}
    >
      <StudioTooltip content={label}>
        <Button
          mode="bleed"
          padding={2}
          icon={mode === 'desktop' ? MobileDeviceIcon : DesktopIcon}
          aria-label={label}
          onClick={() => {
            const next = mode === 'desktop' ? 'mobile' : 'desktop'
            setMode(next)
            onChange(next)
          }}
        />
      </StudioTooltip>
    </span>
  )
}
