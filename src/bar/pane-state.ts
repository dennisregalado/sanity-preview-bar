/**
 * The document pane's state in the bar: which documents it shows, its width (resizable and
 * remembered), whether it's open (remembered for the tab, so it survives reloads and follows the
 * editor across pages).
 */
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {PREVIEW_PANEL_MIN_PAGE_WIDTH} from '../core/protocol'
import {studioPathToString, toPanePath, toStudioPath} from '../core/sanity-node'
import type {PanelEntry} from './DocumentPanel'

/** Default width: Presentation-like. */
export const PANEL_WIDTH = 420
/** Narrowest the pane resizes to; about the Studio's narrowest comfortable form. */
export const PANEL_MIN_WIDTH = 320

const WIDTH_KEY = 'sanity-preview-bar:pane-width'
const OPEN_KEY = 'sanity-preview-bar:pane-open'

export function readNumber(key: string) {
  try {
    const value = Number(window.localStorage.getItem(key))
    return Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

export function store(
  storage: 'localStorage' | 'sessionStorage',
  key: string,
  value: string | null,
) {
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

export function useViewportWidth() {
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

/** A click-to-edit request (`sanity-preview-bar:edit`): a document and a URL-form path. */
export type EditRequest = {id: string; documentType: string; path: string}

/**
 * The pane's stack after a click-to-edit request. The page's document (`pageId`) opens at the
 * path with nothing above it, keeping its other params; another document at the top is moved to
 * the path; anything else goes on top, so × goes back to the page's. Returns `null` for a path
 * that doesn't parse.
 */
export function editStack(
  stack: PanelEntry[],
  request: EditRequest,
  pageId: string | null,
): PanelEntry[] | null {
  const path = toPanePath(request.path)
  if (!path) return null
  const id = publishedId(request.id)
  const at = (entry: PanelEntry | undefined): PanelEntry =>
    entry?.id === id
      ? {...entry, params: {...entry.params, path}}
      : {id, type: request.documentType, params: {path}}
  if (id === pageId) return [at(stack[0])]
  const top = stack[stack.length - 1]
  if (top?.id === id) return [...stack.slice(0, -1), at(top)]
  return [...stack, at(undefined)]
}

/**
 * A field no schema has: the stepping stone for a top-level field, since no path at all leaves
 * Sanity's open path (and so its focus) where it was.
 */
const REFOCUS_FIELD = '_previewBarRefocus'

/** Long enough for the pane to commit and run its focus effect between two paths. */
const REFOCUS_DELAY_MS = 50

/**
 * Applies a click-to-edit request to a pane stack held in state.
 *
 * A pane that mounts for the request focuses its `path` param on its own. One that stays mounted
 * focuses only when `path` changes, and Sanity skips a focus path it believes it already has: the
 * editor may have moved on in the form, or closed an array item's dialog (which keeps its focus
 * path), or its open path still matches after a blur. So the path steps through its parent for
 * one render first, which also reopens an item's dialog; a top-level field steps through a field
 * no schema has. Checked against `sanity@6.23`'s `useDocumentForm` and `DocumentPaneProvider`.
 */
export function applyEdit(
  current: PanelEntry[],
  request: EditRequest,
  pageId: string | null,
  setStack: (update: (stack: PanelEntry[]) => PanelEntry[]) => void,
) {
  const next = editStack(current, request, pageId)
  if (!next) return
  const top = next[next.length - 1]!
  const shown = current[current.length - 1]
  // The pane is keyed by depth and id (`DocumentPanel`).
  const remounts = !shown || shown.id !== top.id || current.length !== next.length
  if (remounts) {
    setStack(() => next)
    return
  }
  const parent = toStudioPath(request.path)!.slice(0, -1)
  const via = studioPathToString(parent.length ? parent : [REFOCUS_FIELD])
  setStack(() =>
    next.map((entry, index) =>
      index === next.length - 1 ? {...entry, params: {...entry.params, path: via}} : entry,
    ),
  )
  setTimeout(
    () => setStack((stack) => editStack(stack, request, pageId) ?? stack),
    REFOCUS_DELAY_MS,
  )
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
