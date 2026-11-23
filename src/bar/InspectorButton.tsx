/**
 * "Activate inspector" (Shopify's theme editor toolbar): UI only for now. A toggle with the
 * Studio's tooltip and the ⌘⇧I hint; nothing inspects yet.
 */
import {Button} from '@sanity/ui'
import {forwardRef, type SVGProps, useState} from 'react'
import {StudioTooltip} from './StudioTooltip'

/**
 * A selection with a pointer, drawn like `@sanity/icons`: a 25px grid, 1.2 strokes with round
 * joins, open corner brackets on the half-pixel grid (as in `ExpandIcon`), no dashes.
 */
export const InspectIcon = forwardRef<SVGSVGElement, SVGProps<SVGSVGElement>>(
  function InspectIcon(props, ref) {
    return (
      <svg
        data-sanity-icon="inspect"
        width="1em"
        height="1em"
        viewBox="0 0 25 25"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        {...props}
        ref={ref}
      >
        <path
          d="M5.5 9.5V5.5H9.5M15.5 5.5H19.5V9.5M9.5 19.5H5.5V15.5"
          stroke="currentColor"
          strokeWidth={1.2}
          strokeLinejoin="round"
        />
        <path
          d="M12.5 12.5L19.5 15.5L16 16L15.5 19.5L12.5 12.5Z"
          stroke="currentColor"
          strokeWidth={1.2}
          strokeLinejoin="round"
        />
      </svg>
    )
  },
)

export function InspectorButton({onHoverChange}: {onHoverChange: (hovered: boolean) => void}) {
  const [active, setActive] = useState(false)
  const label = active ? 'Deactivate inspector' : 'Activate inspector'
  return (
    <span
      style={{display: 'flex'}}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      onFocus={() => onHoverChange(true)}
      onBlur={() => onHoverChange(false)}
    >
      <StudioTooltip content={label} hotkeys={['Mod', 'Shift', 'I']}>
        <Button
          mode="bleed"
          padding={2}
          icon={InspectIcon}
          selected={active}
          aria-label={label}
          aria-pressed={active}
          onClick={() => setActive((value) => !value)}
        />
      </StudioTooltip>
    </span>
  )
}
