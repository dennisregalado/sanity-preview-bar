/**
 * Preview perspective: which content layers (published, drafts, content releases) the site renders
 * in Sanity preview mode. Shared by the server, the host and the bar UI, so it imports nothing.
 *
 * Release ordering, stacking, filtering and tones mirror the Studio's global perspective menu in
 * `sanity@6.23` (`sortReleases`, `getReleasesPerspectiveStack`, `useActiveReleases`,
 * `ReleasesList`, `getReleaseTone`). `test/preview-perspective.test.ts` checks `sortReleases`
 * against the installed `sanity` export; re-check the rest when bumping `sanity`.
 */

/** Same cookie the Studio's Presentation tool sets through `/preview/enable`. */
export const PERSPECTIVE_COOKIE = 'sanity-preview-perspective'

export const PUBLISHED = 'published'
export const DRAFTS = 'drafts'

/** A resolved perspective: `published`, `drafts`, or a stack of release IDs ending in drafts. */
export type PreviewPerspective = typeof PUBLISHED | typeof DRAFTS | string[]

export type ReleaseType = 'asap' | 'scheduled' | 'undecided'

export type ReleaseDocument = {
  _id: string
  _createdAt: string
  state: string
  publishAt?: string | null
  metadata: {
    title?: string
    releaseType: ReleaseType
    intendedPublishAt?: string | null
    cardinality?: 'one' | 'many'
  }
}

/** The Studio's releases store query (`_.releases.*`, raw perspective). */
export const RELEASES_QUERY = `*[_type == "system.release" && _id in path("_.releases.*")]{
	_id,
	_createdAt,
	state,
	publishAt,
	"metadata": coalesce(metadata, { "title": "", "releaseType": "undecided" })
} | order(_createdAt desc)`

const RELEASE_DOCUMENTS_PREFIX = '_.releases.'
const ARCHIVED_RELEASE_STATES = ['archived', 'published']
export const RELEASE_TYPES: ReleaseType[] = ['asap', 'scheduled', 'undecided']
/** Release IDs are `r` plus random characters; anything else in the cookie is rejected. */
const RELEASE_ID = /^[a-zA-Z0-9_-]{1,64}$/
/** API perspective names that are not releases and must never appear inside a stack. */
const RESERVED = ['raw', PUBLISHED, 'previewDrafts']

export function releaseIdOf(release: ReleaseDocument) {
  return release._id.startsWith(RELEASE_DOCUMENTS_PREFIX)
    ? release._id.slice(RELEASE_DOCUMENTS_PREFIX.length)
    : release._id
}

/** `sortReleases` from `sanity`: undecided (newest first), scheduled (latest first), then ASAP. */
export function sortReleases(releases: ReleaseDocument[] = []) {
  return [...releases].sort((a, b) => {
    const aType = a.metadata.releaseType
    const bType = b.metadata.releaseType
    if (aType === 'undecided' && bType !== 'undecided') return -1
    if (aType !== 'undecided' && bType === 'undecided') return 1
    if (aType === 'undecided' && bType === 'undecided') {
      return new Date(b._createdAt).getTime() - new Date(a._createdAt).getTime()
    }
    if (aType === 'scheduled' && bType === 'scheduled') {
      const aPublishAt = a.publishAt || a.metadata.intendedPublishAt
      if (!aPublishAt) return 1
      const bPublishAt = b.publishAt || b.metadata.intendedPublishAt
      return bPublishAt ? new Date(bPublishAt).getTime() - new Date(aPublishAt).getTime() : -1
    }
    if (aType === 'asap' && bType !== 'asap') return 1
    if (aType !== 'asap' && bType === 'asap') return -1
    if (aType === 'asap' && bType === 'asap') {
      return new Date(b._createdAt).getTime() - new Date(a._createdAt).getTime()
    }
    return 0
  })
}

/** `useActiveReleases`: not archived or published, in menu order (ASAP → scheduled → undecided). */
export function activeReleases(releases: ReleaseDocument[]) {
  return sortReleases(
    releases.filter((release) => !ARCHIVED_RELEASE_STATES.includes(release.state)),
  ).reverse()
}

/** The menu hides single-document releases (Scheduled Drafts); the stack still includes them. */
export function isScheduledDraft(release: ReleaseDocument) {
  return release.metadata.cardinality === 'one'
}

/**
 * `getReleasesPerspectiveStack` (draft model enabled): the selected release, every release that
 * publishes before it, then drafts, minus excluded layers.
 */
export function perspectiveStack({
  selected,
  releases,
  excluded = [],
}: {
  selected: string | undefined
  releases: ReleaseDocument[]
  excluded?: string[]
}): PreviewPerspective {
  if (!selected || selected === DRAFTS) return DRAFTS
  if (selected === PUBLISHED) return PUBLISHED
  const sorted = sortReleases(releases).map(releaseIdOf)
  const index = sorted.indexOf(selected)
  if (index === -1) return [selected, DRAFTS]
  return [...sorted.slice(index), DRAFTS].filter((name) => !excluded.includes(name))
}

/** Parses the cookie (`published`, `drafts`, or comma-separated IDs). Invalid values → drafts. */
export function parsePerspective(value: string | undefined): PreviewPerspective {
  if (!value || value === DRAFTS) return DRAFTS
  if (value === PUBLISHED) return PUBLISHED
  const stack = value.split(',')
  if (stack.length > 32 || stack.some((name) => RESERVED.includes(name))) return DRAFTS
  if (!stack.every((name) => name === DRAFTS || RELEASE_ID.test(name))) return DRAFTS
  return stack.length === 1 && stack[0] === DRAFTS ? DRAFTS : stack
}

export function serializePerspective(perspective: PreviewPerspective) {
  return Array.isArray(perspective) ? perspective.join(',') : perspective
}

/**
 * Recovers the menu state from a stored stack: the first layer is the selection, and anything the
 * Studio would have stacked under it but is missing was hidden with the eye toggle.
 */
export function selectionOf(perspective: PreviewPerspective, releases: ReleaseDocument[]) {
  if (!Array.isArray(perspective)) return {selected: perspective, excluded: [] as string[]}
  const [selected = DRAFTS] = perspective
  const full = perspectiveStack({selected, releases})
  const excluded = Array.isArray(full) ? full.filter((name) => !perspective.includes(name)) : []
  return {selected, excluded}
}

/**
 * The Studio navbar's tone for a perspective (`RootCard tone={getReleaseTone(selectedPerspective)}`):
 * published is positive, drafts default, a release takes its type's tone.
 */
export function perspectiveTone(perspective: PreviewPerspective, releases: ReleaseDocument[]) {
  const {selected} = selectionOf(perspective, releases)
  if (selected === PUBLISHED) return 'positive'
  const release = releases.find((candidate) => releaseIdOf(candidate) === selected)
  return release ? releaseTone(release) : 'default'
}

/** `getReleaseTone` plus `RELEASE_TYPES_TONES`. */
export function releaseTone(release: ReleaseDocument) {
  if (release.state === 'archived') return 'default'
  switch (release.metadata.releaseType) {
    case 'asap':
      return 'caution'
    case 'scheduled':
      return 'suggest'
    default:
      return 'neutral'
  }
}
