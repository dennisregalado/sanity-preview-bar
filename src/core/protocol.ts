/**
 * The site's host (`sanity-preview-bar/host`) frames the bar's route, which renders the React bar
 * (`sanity-preview-bar/bar`) with `@sanity/ui`. Only this protocol is shared, so the site never
 * imports React or Sanity UI. Both sides post to, and accept from, this origin and their
 * counterpart window only.
 */

/** Default route for the framed bar; its endpoints live under it (`/preview-bar/search`, …). */
export const PREVIEW_BAR_ROUTE = '/preview-bar'

/** Visible height of the bar in CSS pixels; the host reserves this much at the bottom of the page. */
export const PREVIEW_BAR_HEIGHT = 50

/**
 * With the document pane open, the page (and the bar) keep at least this many CSS pixels beside
 * it. On a narrower viewport the pane overlays the page instead, above a full-width bar.
 */
export const PREVIEW_PANEL_MIN_PAGE_WIDTH = 360

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
  /**
   * Bar → host: the document pane opened (`width` CSS pixels at the right, above the bar) or
   * closed. The host clips the frame to the bar plus that column and reflows the page beside it.
   */
  | {type: 'sanity-preview-bar:panel'; open: boolean; width: number}

/*
 * Planned, not implemented: click-to-edit (re-sketched for hub-backed preview).
 *
 * The bar's tab has no stega: the storefront turns it on only inside Presentation, because stega
 * needs Sanity's content source maps and the realtime preview hub evaluates GROQ itself (no source
 * maps; a stega client bypasses the hub). So elements are annotated explicitly instead:
 *
 * 1. Storefront: components put Sanity's own `data-sanity` attribute on editable elements, built
 *    with `createDataAttribute({id, type, path})` from the `_id`, `_type` and `_key` already in the
 *    query results (the hub returns them like Sanity does). Section-level first
 *    (`sections[_key=="abc"]`), field-level where it matters (`sections[_key=="abc"].title`).
 *    Presentation's overlays read the same attribute, so it helps there too.
 * 2. Host, while the pane is open: hovering an element with `data-sanity` outlines it (an overlay in
 *    the page, pointer-events none); clicking it posts the message below instead of following a
 *    link (Alt/Option-click follows it). The attribute is `key=value;…`, parsed without
 *    dependencies.
 *      Host → bar: {type: 'sanity-preview-bar:edit'; id: string; type: string; path: string}
 * 3. Bar: the page's document gets the pane param `path` (an array item path opens that item's
 *    editor; a field path focuses the field); another document (a referenced product) opens in the
 *    pane's stack with that `path`.
 */

export function isPreviewBarMessage(data: unknown): data is PreviewBarMessage {
  if (typeof data !== 'object' || data === null || !('type' in data)) return false
  switch (data.type) {
    case 'sanity-preview-bar:ready':
    case 'sanity-preview-bar:hide':
    case 'sanity-preview-bar:refresh':
    case 'sanity-preview-bar:refreshed':
    case 'sanity-preview-bar:search':
    case 'sanity-preview-bar:pane':
      return true
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
        data.width >= 0
      )
    case 'sanity-preview-bar:path':
      // Root-relative only: the bar builds its Studio links from it.
      return 'path' in data && isRootRelative(data.path)
    default:
      return false
  }
}

/** Same-site paths only: the bar builds links from them and the host navigates to them. */
function isRootRelative(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
}
