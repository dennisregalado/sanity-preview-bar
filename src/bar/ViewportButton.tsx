/**
 * The Visual Editor's viewport menu: desktop width, a 768px tablet or a 375px phone. The button
 * shows the current size's device icon; the tool animates the site's frame between sizes.
 */
import DesktopIcon from '@sanity/icons/Desktop'
import MobileDeviceIcon from '@sanity/icons/MobileDevice'
import TabletDeviceIcon from '@sanity/icons/TabletDevice'
import {Button} from '@sanity/ui'
import {Menu, MenuButton} from '@sanity/ui/menu'
import {useState} from 'react'
import type {PreviewBarViewport} from '../core/protocol'
import {useBarPlacement} from './context'
import {StudioMenuItem} from './StudioMenuItem'
import {StudioTooltip} from './StudioTooltip'

const VIEWPORTS = [
  {mode: 'desktop', title: 'Desktop', icon: DesktopIcon},
  {mode: 'tablet', title: 'Tablet', icon: TabletDeviceIcon},
  {mode: 'mobile', title: 'Mobile', icon: MobileDeviceIcon},
] as const

export function ViewportButton({
  onChange,
  onOpenChange,
  onHoverChange,
}: {
  onChange: (mode: PreviewBarViewport) => void
  onOpenChange: (open: boolean) => void
  onHoverChange: (hovered: boolean) => void
}) {
  const place = useBarPlacement()
  const [mode, setMode] = useState<PreviewBarViewport>('desktop')
  const [open, setOpen] = useState(false)
  const current = VIEWPORTS.find((viewport) => viewport.mode === mode) ?? VIEWPORTS[0]
  return (
    <span
      style={{display: 'flex'}}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      onFocus={() => onHoverChange(true)}
      onBlur={() => onHoverChange(false)}
    >
      <StudioTooltip content="Viewport" disabled={open}>
        {/* A span around `MenuButton`, which clones its `button` element to attach its ref. */}
        <span style={{display: 'flex'}}>
          <MenuButton
            id="preview-bar-viewport"
            onOpen={() => {
              setOpen(true)
              onOpenChange(true)
            }}
            onClose={() => {
              setOpen(false)
              onOpenChange(false)
            }}
            popover={{
              animate: true,
              placement: place('top-end'),
              fallbackPlacements: [place('top-start')],
              portal: true,
              tone: 'default',
              zOffset: 3000,
            }}
            button={
              <Button
                mode="bleed"
                padding={2}
                icon={current.icon}
                selected={open}
                aria-label={`Viewport: ${current.title}`}
              />
            }
            menu={
              <Menu padding={1}>
                {VIEWPORTS.map((viewport) => (
                  <StudioMenuItem
                    key={viewport.mode}
                    icon={viewport.icon}
                    text={viewport.title}
                    selected={viewport.mode === mode}
                    onClick={() => {
                      setMode(viewport.mode)
                      onChange(viewport.mode)
                    }}
                  />
                ))}
              </Menu>
            }
          />
        </span>
      </StudioTooltip>
    </span>
  )
}
