import {createContext, useContext} from 'react'

import type {PreviewBarData} from '../core/data'

export const BarDataContext = createContext<PreviewBarData | null>(null)

/** The bar's data: brand, Studio path, endpoints, search kinds. */
export function useBarData() {
  const data = useContext(BarDataContext)
  if (!data) throw new Error('sanity-preview-bar: useBarData outside the bar')
  return data
}

/** Which edge the bar sits on (the host sets it; `readPreviewBarPosition`). */
export const BarPositionContext = createContext<'top' | 'bottom'>('bottom')

type Placement = 'top' | 'top-start' | 'top-end' | 'bottom' | 'bottom-start' | 'bottom-end'

/**
 * A popover placement written for the bottom bar (menus and tooltips open upward), flipped to
 * open downward when the bar is at the top.
 */
export function useBarPlacement() {
  const position = useContext(BarPositionContext)
  return <P extends Placement>(placement: P): Placement =>
    position === 'top' ? (placement.replace('top', 'bottom') as Placement) : placement
}
