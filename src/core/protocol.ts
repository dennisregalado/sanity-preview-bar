/**
 * The site's host (`sanity-preview-bar/host`) frames the bar's route, which renders the React bar
 * (`sanity-preview-bar/bar`) with `@sanity/ui`. Only this protocol is shared, so the site never
 * imports React or Sanity UI. Both sides post to, and accept from, this origin and their
 * counterpart window only.
 */
import type {NodeLabel} from './node-labels'
import {isSameOriginPath} from './paths'
import {MAX_EDIT_PATH_LENGTH, type SanityNode} from './sanity-node'

/** Most nodes one `describe` or `labels` message carries. */
export const MAX_DESCRIBE_NODES = 500

/** Default route for the framed bar; its endpoints live under it (`/preview-bar/search`, …). */
export const PREVIEW_BAR_ROUTE = '/preview-bar'

/** Visible height of the bar in CSS pixels; the host reserves this much at the bottom of the page. */
export const PREVIEW_BAR_HEIGHT = 50

/**
 * With the document pane open, the page (and the bar) keep at least this many CSS pixels beside
 * it. On a narrower viewport the pane overlays the page instead, above a full-width bar.
 */
export const PREVIEW_PANEL_MIN_PAGE_WIDTH = 360

/** Which edge of the viewport the document pane sits on. */
export type PaneSide = 'left' | 'right'

/** Which edge of the viewport the bar sits on. */
export type PreviewBarPosition = 'top' | 'bottom'

/**
 * The host tells the framed bar its position in the frame's URL (`/preview-bar?position=top`), so
 * the bar renders in place from its first frame.
 */
export const PREVIEW_BAR_POSITION_PARAM = 'position'

export function readPreviewBarPosition(search: string): PreviewBarPosition {
  return new URLSearchParams(search).get(PREVIEW_BAR_POSITION_PARAM) === 'top' ? 'top' : 'bottom'
}

/**
 * Where the bar is framed: on the site (by `sanity-preview-bar/host`) or in the Studio's Visual
 * Editor tool (`sanity-preview-bar/studio`), which passes `?context=tool` in the frame's URL.
 */
export type PreviewBarContext = 'site' | 'tool'

export const PREVIEW_BAR_CONTEXT_PARAM = 'context'

export function readPreviewBarContext(search: string): PreviewBarContext {
  return new URLSearchParams(search).get(PREVIEW_BAR_CONTEXT_PARAM) === 'tool' ? 'tool' : 'site'
}

/**
 * The Visual Editor tool frames the site under this window name. It survives navigation inside
 * the frame, so the site can tell it's in the tool (not another embed) on every page.
 */
export const PREVIEW_BAR_FRAME_NAME = 'sanity-preview-bar-frame'

/**
 * Whether this window is the site framed by the Visual Editor tool, where the page reads like a
 * normal preview tab and mounts `mountPreviewBarFrame` instead of the host.
 */
export function isPreviewBarFrame() {
  return (
    typeof window !== 'undefined' &&
    window.self !== window.top &&
    window.name === PREVIEW_BAR_FRAME_NAME
  )
}

/** The Visual Editor's viewport sizes. */
export type PreviewBarViewport = 'desktop' | 'tablet' | 'mobile'

/** A document to open in the Visual Editor's pane; a new one carries its template. */
export type PreviewBarDocument = {
  id: string
  type: string
  template?: string
  templateParameters?: Record<string, unknown>
}

/** The bar's perspective as a menu selection: the chosen layer and the hidden ones. */
export type PreviewBarSelection = {selected: string; excluded: string[]}

export type PreviewBarMessage =
  /** Bar → host, once mounted: asks for the current storefront path. */
  | {type: 'sanity-preview-bar:ready'}
  /** Bar → host: hide the bar until the next full page load (preview mode stays on). */
  | {type: 'sanity-preview-bar:hide'}
  /** Bar → host: the perspective menu opened or closed; the host grows the frame so it fits. */
  | {type: 'sanity-preview-bar:menu'; open: boolean}
  /** Bar → host: the perspective cookie changed; rerun every query and load in place. */
  | {type: 'sanity-preview-bar:refresh'}
  /** Host → bar: the storefront finished refreshing after `refresh`. */
  | {type: 'sanity-preview-bar:refreshed'}
  /** Host → bar: the storefront path and query, sent on `ready` and after every navigation. */
  | {type: 'sanity-preview-bar:path'; path: string}
  /** Host → bar: ⌘K / Ctrl+K was pressed on the storefront page; open search. */
  | {type: 'sanity-preview-bar:search'}
  /** Host → bar: `E` was pressed on the storefront page (not while typing); toggle the pane. */
  | {type: 'sanity-preview-bar:pane'}
  /** Bar → host: a search result was chosen; navigate the storefront there (client-side). */
  | {type: 'sanity-preview-bar:navigate'; href: string}
  /** Bar → Visual Editor tool: open this document in the tool's pane (Edit, Create new document). */
  | {type: 'sanity-preview-bar:open-document'; document: PreviewBarDocument}
  /**
   * Visual Editor tool → bar: the tool's pane opened or closed (Edit hides while it's open), and
   * whether the page has a document to edit (Edit shows only then).
   */
  | {type: 'sanity-preview-bar:editor-state'; open: boolean; available?: boolean}
  /** Visual Editor tool → bar: the current page's document (the page picker previews it), if any. */
  | {type: 'sanity-preview-bar:page-document'; document: {id: string; type: string} | null}
  /** Bar → Visual Editor tool: Edit was clicked; open the page's document in the pane. */
  | {type: 'sanity-preview-bar:open-editor'}
  /** Bar → Visual Editor tool: show the site at desktop width, as a 768px tablet or a 375px phone. */
  | {type: 'sanity-preview-bar:viewport'; mode: PreviewBarViewport}
  /** Bar → Visual Editor tool: the bar's perspective changed; the Studio follows it. */
  | {type: 'sanity-preview-bar:perspective'; selection: PreviewBarSelection}
  /** Visual Editor tool → bar: the Studio's perspective changed (pane chips, navbar); switch to it. */
  | {type: 'sanity-preview-bar:set-perspective'; selection: PreviewBarSelection}
  /** Bar → Visual Editor tool: the logo was clicked; go to the Studio (its router, no reload). */
  | {type: 'sanity-preview-bar:studio-home'}
  /** Site framed by the Visual Editor tool → tool: its path and query, on load and navigation. */
  | {type: 'sanity-preview-bar:frame-path'; path: string}
  /**
   * Bar → host: the document pane opened (a full-height column `width` CSS pixels wide on `side`)
   * or closed. The host clips the frame to that column plus the bar and reflows the page beside it.
   */
  | {type: 'sanity-preview-bar:panel'; open: boolean; width: number; side: PaneSide}
  /**
   * Site framed by the Visual Editor tool → tool: an element marked with `data-sanity` was clicked
   * while the inspector is on (click-to-edit, `sanity-preview-bar/host`'s overlay). Open `id` in the document pane
   * at `path`, which is in Sanity's URL form as written in the attribute (`sections:k1.heading`);
   * `toPanePath` turns it into the pane's `path` param. The page's own document opens at the path
   * (an array item opens its editor, a field gets focus); any other document goes on the pane's
   * stack.
   */
  | {type: 'sanity-preview-bar:edit'; id: string; documentType: string; path: string}
  /**
   * Visual Editor tool → framed site: the document pane focused a field (`path` in
   * URL form) of document `id`; the overlay outlines the elements that show it and scrolls one into
   * view. Empty `id` and `path` clear it.
   */
  | {type: 'sanity-preview-bar:focus'; id: string; path: string}
  /**
   * Bar → Visual Editor tool → framed site: the inspector (the bar's "Activate inspector" button or
   * ⌘⇧I) turned click-to-edit on or off. The tool resends it after every page load in the frame.
   */
  | {type: 'sanity-preview-bar:inspector'; active: boolean}
  /** Framed site → Visual Editor tool → bar: ⌘⇧I was pressed on the page; toggle the inspector. */
  | {type: 'sanity-preview-bar:toggle-inspector'}
  /**
   * Framed site → Visual Editor tool: label these `data-sanity` nodes (field titles
   * from the Studio's schema) and check that their paths resolve. Answered with `labels`.
   */
  | {type: 'sanity-preview-bar:describe'; nodes: SanityNode[]}
  /** Visual Editor tool → framed site: the answer to `describe`. */
  | {type: 'sanity-preview-bar:labels'; labels: NodeLabel[]}

/** ⌘⇧I / Ctrl+Shift+I: the inspector's shortcut, in the bar and on the framed page. */
export function isInspectorShortcut(event: {
  key: string
  code?: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  repeat?: boolean
}) {
  return (
    (event.key.toLowerCase() === 'i' || event.code === 'KeyI') &&
    (event.metaKey || event.ctrlKey) &&
    event.shiftKey &&
    !event.altKey &&
    !event.repeat
  )
}

export function isPreviewBarMessage(data: unknown): data is PreviewBarMessage {
  if (typeof data !== 'object' || data === null || !('type' in data)) return false
  switch (data.type) {
    case 'sanity-preview-bar:ready':
    case 'sanity-preview-bar:hide':
    case 'sanity-preview-bar:refresh':
    case 'sanity-preview-bar:refreshed':
    case 'sanity-preview-bar:search':
    case 'sanity-preview-bar:pane':
    case 'sanity-preview-bar:studio-home':
    case 'sanity-preview-bar:open-editor':
    case 'sanity-preview-bar:toggle-inspector':
      return true
    case 'sanity-preview-bar:inspector':
      return 'active' in data && typeof data.active === 'boolean'
    case 'sanity-preview-bar:navigate':
      return 'href' in data && isRootRelative(data.href)
    case 'sanity-preview-bar:menu':
      return 'open' in data && typeof data.open === 'boolean'
    case 'sanity-preview-bar:panel':
      return (
        'open' in data &&
        typeof data.open === 'boolean' &&
        'width' in data &&
        typeof data.width === 'number' &&
        Number.isFinite(data.width) &&
        data.width >= 0 &&
        'side' in data &&
        (data.side === 'left' || data.side === 'right')
      )
    case 'sanity-preview-bar:path':
    case 'sanity-preview-bar:frame-path':
      // Root-relative only: the bar builds its Studio links from it.
      return 'path' in data && isRootRelative(data.path)
    case 'sanity-preview-bar:page-document':
      return (
        'document' in data &&
        (data.document === null ||
          (typeof data.document === 'object' &&
            typeof (data.document as Record<string, unknown>).id === 'string' &&
            typeof (data.document as Record<string, unknown>).type === 'string'))
      )
    case 'sanity-preview-bar:open-document':
      return 'document' in data && isDocument(data.document)
    case 'sanity-preview-bar:editor-state':
      return (
        'open' in data &&
        typeof data.open === 'boolean' &&
        (!('available' in data) ||
          data.available === undefined ||
          typeof data.available === 'boolean')
      )
    case 'sanity-preview-bar:viewport':
      return (
        'mode' in data &&
        (data.mode === 'desktop' || data.mode === 'tablet' || data.mode === 'mobile')
      )
    case 'sanity-preview-bar:perspective':
    case 'sanity-preview-bar:set-perspective':
      return 'selection' in data && isSelection(data.selection)
    case 'sanity-preview-bar:edit':
      return (
        'id' in data &&
        isNonEmptyString(data.id) &&
        'documentType' in data &&
        isNonEmptyString(data.documentType) &&
        'path' in data &&
        isNonEmptyString(data.path) &&
        data.path.length <= MAX_EDIT_PATH_LENGTH
      )
    case 'sanity-preview-bar:focus':
      return (
        'id' in data &&
        typeof data.id === 'string' &&
        'path' in data &&
        typeof data.path === 'string' &&
        data.path.length <= MAX_EDIT_PATH_LENGTH
      )
    case 'sanity-preview-bar:describe':
      return (
        'nodes' in data &&
        Array.isArray(data.nodes) &&
        data.nodes.length <= MAX_DESCRIBE_NODES &&
        data.nodes.every(isNode)
      )
    case 'sanity-preview-bar:labels':
      return (
        'labels' in data &&
        Array.isArray(data.labels) &&
        data.labels.length <= MAX_DESCRIBE_NODES &&
        data.labels.every(isLabel)
      )
    default:
      return false
  }
}

function isNode(value: unknown): value is SanityNode {
  if (typeof value !== 'object' || value === null) return false
  const node = value as Record<string, unknown>
  return (
    isNonEmptyString(node.id) &&
    isNonEmptyString(node.type) &&
    isNonEmptyString(node.path) &&
    node.path.length <= MAX_EDIT_PATH_LENGTH
  )
}

function isLabel(value: unknown): value is NodeLabel {
  if (typeof value !== 'object' || value === null) return false
  const label = value as Record<string, unknown>
  return (
    isNonEmptyString(label.id) &&
    isNonEmptyString(label.path) &&
    label.path.length <= MAX_EDIT_PATH_LENGTH &&
    typeof label.label === 'string' &&
    label.label.length <= 200 &&
    (label.missing === undefined || typeof label.missing === 'boolean')
  )
}

function isDocument(value: unknown): value is PreviewBarDocument {
  if (typeof value !== 'object' || value === null) return false
  const doc = value as Record<string, unknown>
  return (
    typeof doc.id === 'string' &&
    doc.id.length > 0 &&
    typeof doc.type === 'string' &&
    doc.type.length > 0 &&
    (doc.template === undefined || typeof doc.template === 'string') &&
    (doc.templateParameters === undefined ||
      (typeof doc.templateParameters === 'object' && doc.templateParameters !== null))
  )
}

function isSelection(value: unknown): value is PreviewBarSelection {
  if (typeof value !== 'object' || value === null) return false
  const selection = value as Record<string, unknown>
  return (
    typeof selection.selected === 'string' &&
    Array.isArray(selection.excluded) &&
    selection.excluded.every((id) => typeof id === 'string')
  )
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/** Same-site paths only: the bar builds links from them and the host navigates to them. */
function isRootRelative(value: unknown): value is string {
  return isSameOriginPath(value)
}
