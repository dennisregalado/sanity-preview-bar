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
  /** Bar → host: a search result was chosen; navigate the storefront there (client-side). */
  | {type: 'sanity-preview-bar:navigate'; href: string}

export function isPreviewBarMessage(data: unknown): data is PreviewBarMessage {
  if (typeof data !== 'object' || data === null || !('type' in data)) return false
  switch (data.type) {
    case 'sanity-preview-bar:ready':
    case 'sanity-preview-bar:hide':
    case 'sanity-preview-bar:refresh':
    case 'sanity-preview-bar:refreshed':
    case 'sanity-preview-bar:search':
      return true
    case 'sanity-preview-bar:navigate':
      return 'href' in data && isRootRelative(data.href)
    case 'sanity-preview-bar:menu':
      return 'open' in data && typeof data.open === 'boolean'
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
