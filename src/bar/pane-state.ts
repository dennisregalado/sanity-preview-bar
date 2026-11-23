/**
 * The document pane's state in the bar: which documents it shows, its width (resizable and
 * remembered), whether it's open (remembered for the tab, so it survives reloads and follows the
 * editor across pages).
 */
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {PREVIEW_PANEL_MIN_PAGE_WIDTH} from '../core/protocol'
import type {PanelEntry} from './DocumentPanel'

/** Default width: Presentation-like. */
export const PANEL_WIDTH = 420
/** Narrowest the pane resizes to; about the Studio's narrowest comfortable form. */
export const PANEL_MIN_WIDTH = 320

const WIDTH_KEY = 'sanity-preview-bar:pane-width'
const OPEN_KEY = 'sanity-preview-bar:pane-open'

function readNumber(key: string) {
  try {
    const value = Number(window.localStorage.getItem(key))
    return Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

function store(storage: 'localStorage' | 'sessionStorage', key: string, value: string | null) {
  try {
    if (value === null) window[storage].removeItem(key)
    else window[storage].setItem(key, value)
  } catch {
    // Storage blocked (private mode, sandboxing): the pane just doesn't remember.
  }
}

function readOpen() {
  try {
    return window.sessionStorage.getItem(OPEN_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * The pane's actual width for a preferred width and viewport. Beside the page it keeps the page at
 * least `PREVIEW_PANEL_MIN_PAGE_WIDTH` wide; when even the narrowest pane can't, it overlays the
 * page (not resizable) instead.
 */
export function panelLayout(preferred: number, viewport: number) {
  if (viewport - PANEL_MIN_WIDTH < PREVIEW_PANEL_MIN_PAGE_WIDTH) {
    return {width: Math.min(PANEL_WIDTH, viewport), beside: false}
  }
  const max = viewport - PREVIEW_PANEL_MIN_PAGE_WIDTH
  return {width: Math.round(Math.min(Math.max(preferred, PANEL_MIN_WIDTH), max)), beside: true}
}

function useViewportWidth() {
  const [width, setWidth] = useState(() => window.innerWidth)
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return width
}

/** A document's published ID: the pane takes it whatever version the page resolved. */
export function publishedId(id: string) {
  return id.replace(/^drafts\./, '').replace(/^versions\.[^.]+\./, '')
}

export function useDocumentPaneState({
  enabled,
  pageDocument,
  setOverflow,
}: {
  /** The pane is configured and the editor is signed in. */
  enabled: boolean
  pageDocument: {_id: string; _type: string} | null
  setOverflow: (key: string, visible: boolean) => void
}) {
  const viewport = useViewportWidth()
  const [preferred, setPreferred] = useState(() => readNumber(WIDTH_KEY) ?? PANEL_WIDTH)
  const {width, beside} = useMemo(() => panelLayout(preferred, viewport), [preferred, viewport])

  const [stack, setStack] = useState<PanelEntry[]>([])
  const open = enabled && stack.length > 0

  const pageEntry = useMemo<PanelEntry | null>(
    () =>
      pageDocument
        ? {id: publishedId(pageDocument._id), type: pageDocument._type, params: {}}
        : null,
    [pageDocument],
  )

  // Follow the page: a new page's document replaces the stack; a page without one closes the pane
  // but keeps it "open" for the tab, so the next page with a document (or a reload) reopens it.
  useEffect(() => {
    setStack((current) => {
      if (!pageEntry) return current.length ? [] : current
      if (current.length === 0) return readOpen() ? [pageEntry] : current
      return current[0]?.id === pageEntry.id ? current : [pageEntry]
    })
  }, [pageEntry])

  const change = useCallback((next: PanelEntry[]) => {
    if (next.length === 0) store('sessionStorage', OPEN_KEY, null)
    setStack(next)
  }, [])

  const openPane = useCallback(() => {
    if (!pageEntry) return
    store('sessionStorage', OPEN_KEY, '1')
    setStack([pageEntry])
  }, [pageEntry])

  /** Opens another document (a new one from "Create new document") on top of the pane's stack. */
  const openDocument = useCallback((entry: PanelEntry) => {
    store('sessionStorage', OPEN_KEY, '1')
    setStack((current) => (current.length ? [...current, entry] : [entry]))
  }, [])

  const toggle = useCallback(() => {
    if (open) change([])
    else openPane()
  }, [open, change, openPane])

  // Resizing: live while dragging (the host reflows the page as it goes), remembered on release.
  const latest = useRef(width)
  latest.current = width
  const resizeStart = useCallback(() => setOverflow('pane-resize', true), [setOverflow])
  const resizeTo = useCallback((next: number) => setPreferred(next), [])
  const resizeEnd = useCallback(() => {
    setOverflow('pane-resize', false)
    setPreferred(latest.current)
    store('localStorage', WIDTH_KEY, String(latest.current))
  }, [setOverflow])

  return {
    stack,
    open,
    width,
    beside,
    canOpen: Boolean(pageEntry),
    openPane,
    openDocument,
    toggle,
    change,
    resize: beside ? {start: resizeStart, to: resizeTo, end: resizeEnd} : null,
  }
}
