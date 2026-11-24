'use client'
/**
 * Next.js client components. `PreviewBarHost` goes in the site's root layout (rendered only in
 * draft mode); `PreviewBarFrame` and `PreviewLinkErrorFrame` render the bar's page and the
 * expired-link page. React and Sanity UI load only from the frames' dynamic imports, so the host
 * stays a few KB.
 */
import {usePathname, useRouter} from 'next/navigation'
import {useEffect, useRef, useState} from 'react'

import type {PreviewBarData, PreviewLinkErrorData} from '../core/data'
import {isPreviewBarFrame} from '../core/protocol'
import {isTopWindow, type PreviewBarHost as Host} from '../host'

/**
 * Mounts the bar's frame in the top window while draft mode is on. In the Studio's Visual Editor
 * tool's frame (`isPreviewBarFrame()`), it answers the tool instead (`mountPreviewBarFrame`): the
 * tool shows its own bar above the page. Other frames are skipped.
 */
export function PreviewBarHost({basePath}: {basePath?: string}) {
  const router = useRouter()
  const pathname = usePathname()
  const [host, setHost] = useState<Host | null>(null)

  useEffect(() => {
    const frame = isPreviewBarFrame()
    if (!frame && !isTopWindow()) return
    let cancelled = false
    let mounted: Host | undefined
    import('../host').then(({mountPreviewBarHost, mountPreviewBarFrame}) => {
      if (cancelled) return
      const options = {
        // Server components rerun with the new perspective cookie; client state stays.
        refresh: () => router.refresh(),
        navigate: (href: string) => router.push(href),
      }
      mounted = frame ? mountPreviewBarFrame(options) : mountPreviewBarHost({...options, basePath})
      setHost(mounted)
    })
    return () => {
      cancelled = true
      mounted?.destroy()
      setHost(null)
    }
  }, [basePath, router])

  // Keep the bar's path current after client-side navigation.
  useEffect(() => {
    host?.setPath(window.location.pathname + window.location.search)
  }, [host, pathname])

  return null
}

type BarModule = typeof import('../bar')

/**
 * Mounts a React root from the lazily loaded bar module into this component's element. The
 * cancellation check runs before mounting, so React's development double-run of effects never
 * mounts two roots on one element.
 */
function useMounted(mount: (bar: BarModule, element: HTMLElement) => () => void, deps: unknown[]) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    let unmount: (() => void) | undefined
    let cancelled = false
    import('../bar').then((bar) => {
      if (!cancelled) unmount = mount(bar, element)
    })
    return () => {
      cancelled = true
      unmount?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return ref
}

/** The bar itself, for `app/preview-bar/page.tsx`. */
export function PreviewBarFrame({data}: {data: PreviewBarData}) {
  const ref = useMounted(({mountPreviewBar}, element) => mountPreviewBar(element, data), [data])
  return <div ref={ref} style={{height: '100%'}} />
}

/** The expired-link page, for `/p/[code]` and its `not-found.tsx`. */
export function PreviewLinkErrorFrame(props: PreviewLinkErrorData) {
  const ref = useMounted(
    ({mountPreviewLinkError}, element) => mountPreviewLinkError(element, props),
    [props.expired, props.brand, props.studioPath],
  )
  return <div ref={ref} />
}
