import {createContext, useContext} from 'react'

import type {PreviewBarData} from '../core/data'

export const BarDataContext = createContext<PreviewBarData | null>(null)

/** The bar's data: brand, Studio path, endpoints, search kinds. */
export function useBarData() {
  const data = useContext(BarDataContext)
  if (!data) throw new Error('sanity-preview-bar: useBarData outside the bar')
  return data
}
