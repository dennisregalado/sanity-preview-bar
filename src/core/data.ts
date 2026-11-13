import type {SearchKindOption} from './link-search'
import type {ReleaseDocument} from './perspective'

/** How the bar shows the project: the Studio navbar's mark and workspace title. */
export type PreviewBarBrand = {
  /** The workspace title, e.g. "Acme". */
  title: string
  /**
   * The mark beside it, drawn like the Studio's workspace icon: inline `<svg …>` markup (use
   * `fill="currentColor"` to follow the bar's text colour) or an image URL.
   */
  logo?: string
  /**
   * The Sanity project's name, shown above the title in the workspace menu (the Studio reads it
   * from the management API with the editor's session, which the bar doesn't have).
   */
  project?: string
}

/** Everything the framed bar renders from. Serializable: the server hands it to the page. */
export type PreviewBarData = {
  brand: PreviewBarBrand
  /** Where the embedded Studio lives, e.g. `/studio`. */
  studioPath: string
  /** The Sanity project ID, for the workspace menu's "Manage project" and "Invite members". */
  projectId: string | null
  /** The bar's route; its endpoints live under it. */
  basePath: string
  releases: ReleaseDocument[]
  releasesError: boolean
  /** Short links are configured and Presentation's "Share this preview" is on. */
  sharing: boolean
  /** Short links are configured at all. */
  links: boolean
  /** The serialized perspective cookie value the server applied to this request. */
  perspective: string
  /** The search's type filter, or `null` when search is off. */
  search: SearchKindOption[] | null
}

/** What the expired-link page renders from. */
export type PreviewLinkErrorData = {
  brand: PreviewBarBrand
  /** `true` for an unknown or expired link (404); `false` when links couldn't be read (503). */
  expired: boolean
  /** Where "Go to <brand>" leads; defaults to `/`. */
  home?: string
}
