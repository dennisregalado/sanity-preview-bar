import {describe, expect, test} from 'vitest'
import {
  activeReleases,
  parsePerspective,
  perspectiveStack,
  releaseIdOf,
  selectionOf,
  serializePerspective,
  sortReleases,
  type ReleaseDocument,
} from '../src/core/perspective'

function release(
  id: string,
  releaseType: ReleaseDocument['metadata']['releaseType'],
  extra: {createdAt?: string; publishAt?: string; state?: string; cardinality?: 'one'} = {},
): ReleaseDocument {
  return {
    _id: `_.releases.${id}`,
    _createdAt: extra.createdAt ?? '2026-11-01T00:00:00Z',
    state: extra.state ?? (releaseType === 'scheduled' ? 'scheduled' : 'active'),
    publishAt: releaseType === 'scheduled' ? (extra.publishAt ?? null) : null,
    metadata: {
      title: id,
      releaseType,
      intendedPublishAt: releaseType === 'scheduled' ? extra.publishAt : undefined,
      cardinality: extra.cardinality,
    },
  }
}

const asapOld = release('rAsapOld', 'asap', {createdAt: '2026-11-01T00:00:00Z'})
const asapNew = release('rAsapNew', 'asap', {createdAt: '2026-11-05T00:00:00Z'})
const monday = release('rMonday', 'scheduled', {publishAt: '2026-11-16T10:00:00Z'})
const friday = release('rFriday', 'scheduled', {publishAt: '2026-11-20T10:00:00Z'})
const draftSoon = release('rDraftSoon', 'scheduled', {
  publishAt: '2026-11-14T10:00:00Z',
  cardinality: 'one',
})
const idea = release('rIdea', 'undecided', {createdAt: '2026-11-03T00:00:00Z'})
const archived = release('rArchived', 'asap', {state: 'archived'})
const published = release('rPublished', 'asap', {state: 'published'})
const all = [idea, friday, asapOld, archived, monday, draftSoon, published, asapNew]

describe('sortReleases', () => {
  test('matches the installed sanity export', async () => {
    const {sortReleases: studioSort} = await import('sanity')
    expect(sortReleases(all).map(releaseIdOf)).toEqual(studioSort(all as never).map(releaseIdOf))
    // Importing the whole `sanity` package can take several seconds on a cold or busy machine.
  }, 30_000)
})

describe('activeReleases', () => {
  test('drops archived and published, in menu order (ASAP → at time → undecided)', () => {
    expect(activeReleases(all).map(releaseIdOf)).toEqual([
      'rAsapOld',
      'rAsapNew',
      'rDraftSoon',
      'rMonday',
      'rFriday',
      'rIdea',
    ])
  })
})

describe('perspectiveStack', () => {
  const releases = activeReleases(all)

  test('defaults and system perspectives', () => {
    expect(perspectiveStack({selected: undefined, releases})).toBe('drafts')
    expect(perspectiveStack({selected: 'drafts', releases})).toBe('drafts')
    expect(perspectiveStack({selected: 'published', releases})).toBe('published')
  })

  test('a scheduled release stacks every release that publishes before it, then drafts', () => {
    expect(perspectiveStack({selected: 'rFriday', releases})).toEqual([
      'rFriday',
      'rMonday',
      'rDraftSoon',
      'rAsapNew',
      'rAsapOld',
      'drafts',
    ])
  })

  test('an undecided release sits on top of everything scheduled and ASAP', () => {
    expect(perspectiveStack({selected: 'rIdea', releases})).toEqual([
      'rIdea',
      'rFriday',
      'rMonday',
      'rDraftSoon',
      'rAsapNew',
      'rAsapOld',
      'drafts',
    ])
  })

  test('excluded layers drop out; an unknown release falls back to itself over drafts', () => {
    expect(
      perspectiveStack({selected: 'rMonday', releases, excluded: ['rAsapOld', 'drafts']}),
    ).toEqual(['rMonday', 'rDraftSoon', 'rAsapNew'])
    expect(perspectiveStack({selected: 'rGone', releases})).toEqual(['rGone', 'drafts'])
  })
})

describe('selectionOf', () => {
  test('recovers the selection and hidden layers from a stored stack', () => {
    const releases = activeReleases(all)
    const stack = perspectiveStack({selected: 'rFriday', releases, excluded: ['rAsapNew']})
    expect(selectionOf(stack, releases)).toEqual({selected: 'rFriday', excluded: ['rAsapNew']})
    expect(selectionOf('published', releases)).toEqual({selected: 'published', excluded: []})
  })
})

describe('parsePerspective', () => {
  test('round-trips valid values and rejects anything else as drafts', () => {
    expect(parsePerspective(undefined)).toBe('drafts')
    expect(parsePerspective('published')).toBe('published')
    expect(parsePerspective('rA,rB,drafts')).toEqual(['rA', 'rB', 'drafts'])
    expect(serializePerspective(['rA', 'drafts'])).toBe('rA,drafts')
    for (const bad of ['raw', 'rA,published', 'rA,<script>', 'rA,,drafts', 'x'.repeat(65)]) {
      expect(parsePerspective(bad)).toBe('drafts')
    }
  })
})
