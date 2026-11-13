/**
 * Link search for the preview bar: the Studio's `groq2024` search (`createSearch`) rebuilt as one
 * GROQ query over the project's document types, plus its fixed routes. Pure, so it runs on the
 * server and is testable.
 *
 * Mirrors `sanity@6.23`:
 * - filter `[@, _id] match text::query($q)` (every string field) or a pasted document ID;
 * - `score()` with `boost(<preview field> match text::query($q), weight)` using
 *   `PREVIEW_FIELD_WEIGHT_MAP` (title 10, subtitle 5);
 * - the last term matched as a prefix (`prefixLast`), so "chai" finds "Chair";
 * - the Studio's sort options (best match, created/updated oldest/newest).
 */

export const SEARCH_PAGE_SIZE = 40

/** A fixed page with no document behind it, such as the homepage or the cart. */
export type SearchRoute = {
  title: string
  path: string
  /** Shown in place of a thumbnail. */
  emoji?: string
}

/** A document type the search lists, and how its documents become links. */
export type SearchDocumentType = {
  /** The schema type name (`_type`). */
  type: string
  /** The schema type's title: the result badge and the types filter label. */
  title: string
  /** Shown when a document has no image. */
  emoji?: string
  /**
   * GROQ expressions, evaluated per document. `title` and `slug` are required; a document without a
   * slug is left out (it has no page to open).
   * @example { title: 'store.title', slug: 'store.slug.current', image: 'store.previewImageUrl' }
   */
  fields: {
    title: string
    slug: string
    subtitle?: string
    /** An image URL: Sanity and Shopify CDN URLs are resized for the 33px thumbnail. */
    image?: string
  }
  /**
   * Plain field paths to boost, like the Studio's preview fields (title 10, subtitle 5). Defaults
   * to `fields.title` and `fields.subtitle`; set this when those are computed expressions, and
   * `subtitle: null` to boost the title only.
   */
  boost?: {title?: string; subtitle?: string | null}
  /** An extra GROQ filter, e.g. `store.isDeleted != true`. */
  filter?: string
  /** The page a document opens, from its slug. */
  href: (slug: string) => string
}

export type SearchConfig = {
  routes?: SearchRoute[]
  types?: SearchDocumentType[]
}

export type SearchSort = 'best' | 'createdAsc' | 'createdDesc' | 'updatedAsc' | 'updatedDesc'
export const SEARCH_SORTS: SearchSort[] = [
  'best',
  'createdAsc',
  'createdDesc',
  'updatedAsc',
  'updatedDesc',
]

/** `'route'` stands for the fixed routes; anything else is a document type name. */
export type SearchKind = string
export const ROUTE_KIND = 'route'

/** The types filter, as the bar receives it: serializable, no functions. */
export type SearchKindOption = {kind: SearchKind; title: string}

export type SearchStatus = 'draft' | 'published' | 'version'

export type SearchResult = {
  key: string
  kind: SearchKind
  title: string
  subtitle: string | null
  /** A 66px thumbnail URL, or `null` to show the emoji. */
  image: string | null
  emoji: string
  /** The type badge (the schema type's title, or "Route"). */
  badge: string
  /**
   * The versions that exist, in the Studio's indicator order (draft ring before the published dot,
   * then a release version); empty for routes.
   */
  status: SearchStatus[]
  href: string
}

export type SearchDocument = {
  _id: string
  _type: string
  _originalId?: string
  title: string | null
  subtitle: string | null
  image: string | null
  slug: string | null
}

const WEIGHTS = {title: 10, subtitle: 5}
const DEFAULT_EMOJI = '📄'
const TYPE_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/

/** The kinds the bar can filter by: routes first (when there are any), then each type. */
export function searchKinds(config: SearchConfig): SearchKindOption[] {
  return [
    ...(config.routes?.length ? [{kind: ROUTE_KIND, title: 'Route'}] : []),
    ...(config.types ?? []).map((type) => ({kind: type.type, title: type.title})),
  ]
}

/** `prefixLast` from `sanity`: the final unquoted term matches as a prefix. */
export function prefixLast(query: string) {
  const terms = query.trim().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return ''
  const last = terms[terms.length - 1]
  if (!last.endsWith('*') && !last.endsWith('"')) terms[terms.length - 1] = `${last}*`
  return terms.join(' ')
}

function typesOf(config: SearchConfig, names: string[]) {
  return (config.types ?? []).filter((type) => names.includes(type.type))
}

function assertTypeName(name: string) {
  if (!TYPE_NAME.test(name)) throw new Error(`sanity-preview-bar: invalid type name "${name}"`)
}

function boosts(types: SearchDocumentType[]) {
  return types.flatMap((type) => {
    const title = type.boost?.title ?? type.fields.title
    const subtitle =
      type.boost && 'subtitle' in type.boost ? type.boost.subtitle : type.fields.subtitle
    const parts = [
      `boost(_type == "${type.type}" && ${title} match text::query($q), ${WEIGHTS.title})`,
    ]
    if (subtitle) {
      parts.push(
        `boost(_type == "${type.type}" && ${subtitle} match text::query($q), ${WEIGHTS.subtitle})`,
      )
    }
    return parts
  })
}

/** `select(_type == "a" => <a's expression>, …, null)` for one projected field. */
function selectField(types: SearchDocumentType[], field: keyof SearchDocumentType['fields']) {
  const cases = types.flatMap((type) =>
    type.fields[field] ? [`_type == "${type.type}" => ${type.fields[field]}`] : [],
  )
  return cases.length ? `select(${[...cases, 'null'].join(', ')})` : 'null'
}

const ORDER: Record<Exclude<SearchSort, 'best'>, string> = {
  createdAsc: '_createdAt asc',
  createdDesc: '_createdAt desc',
  updatedAsc: '_updatedAt asc',
  updatedDesc: '_updatedAt desc',
}

/**
 * The document query for the given types. Params: `$types`, `$q` (prefixed), `$raw` (trimmed
 * input, for ID matches), `$start`, `$end`.
 */
export function buildSearchQuery({
  config,
  types: names,
  hasQuery,
  sort,
}: {
  config: SearchConfig
  types: string[]
  hasQuery: boolean
  sort: SearchSort
}) {
  const types = typesOf(config, names)
  types.forEach((type) => assertTypeName(type.type))
  const typeFilters = types.flatMap((type) =>
    type.filter ? [`(_type != "${type.type}" || (${type.filter}))`] : [],
  )
  const filter = [
    '_type in $types',
    ...typeFilters,
    hasQuery ? '([@, _id] match text::query($q) || _id in string::split($raw, "/"))' : null,
  ]
    .filter(Boolean)
    .join(' && ')
  const score = hasQuery
    ? ` | score(${[...boosts(types), '[@, _id] match text::query($q)'].join(', ')})`
    : ''
  const order =
    sort === 'best' ? (hasQuery ? '_score desc, _updatedAt desc' : '_updatedAt desc') : ORDER[sort]
  const projection = `{
  _id,
  _type,
  _originalId,
  "title": ${selectField(types, 'title')},
  "subtitle": ${selectField(types, 'subtitle')},
  "image": ${selectField(types, 'image')},
  "slug": ${selectField(types, 'slug')}
}`
  return `*[${filter}]${score} | order(${order})[$start...$end]${projection}`
}

/** A 66px (2x) thumbnail: Sanity image-URL and Shopify CDN resizing; other URLs as they are. */
export function thumbnail(image: string | null) {
  if (!image) return null
  let url: URL
  try {
    url = new URL(image)
  } catch {
    return null
  }
  if (url.hostname === 'cdn.sanity.io') {
    for (const [key, value] of Object.entries({w: '66', h: '66', fit: 'max', auto: 'format'})) {
      url.searchParams.set(key, value)
    }
  } else if (url.hostname === 'cdn.shopify.com' || url.pathname.includes('/cdn/shop/')) {
    url.searchParams.set('width', '66')
  }
  return url.toString()
}

/**
 * `existing` holds the raw IDs that exist (published and `drafts.` IDs, from one raw-perspective
 * lookup), so a document with both a draft and a published version shows both, as the Studio does.
 * Without it, the shown version alone decides.
 */
export function documentResult(
  config: SearchConfig,
  doc: SearchDocument,
  existing?: Set<string>,
): SearchResult | null {
  if (!doc.slug) return null
  const type = config.types?.find((candidate) => candidate.type === doc._type)
  if (!type) return null
  const original = doc._originalId ?? doc._id
  return {
    key: doc._id,
    kind: doc._type,
    title: doc.title || 'Untitled',
    subtitle: doc.subtitle,
    image: thumbnail(doc.image),
    emoji: type.emoji ?? DEFAULT_EMOJI,
    badge: type.title,
    status: statusOf(doc._id, original, existing),
    href: type.href(doc.slug),
  }
}

function statusOf(id: string, original: string, existing?: Set<string>): SearchStatus[] {
  const status: SearchStatus[] = []
  const hasDraft = existing ? existing.has(`drafts.${id}`) : original.startsWith('drafts.')
  const hasPublished = existing
    ? existing.has(id)
    : !original.startsWith('drafts.') && !original.startsWith('versions.')
  if (hasDraft) status.push('draft')
  if (hasPublished) status.push('published')
  if (original.startsWith('versions.')) status.push('version')
  return status
}

/** The raw IDs to look up for `documentResult`'s `existing`. */
export function versionIds(docs: {_id: string}[]) {
  return docs.flatMap((doc) => [doc._id, `drafts.${doc._id}`])
}

/** The fixed routes whose title matches the query (all of them when it's empty). */
export function routeResults(config: SearchConfig, query: string): SearchResult[] {
  const needle = query.trim().toLowerCase()
  return (config.routes ?? []).flatMap((route) =>
    !needle || route.title.toLowerCase().includes(needle)
      ? [
          {
            key: `route:${route.path}`,
            kind: ROUTE_KIND,
            title: route.title,
            subtitle: route.path,
            image: null,
            emoji: route.emoji ?? '🔗',
            badge: 'Route',
            status: [],
            href: route.path,
          },
        ]
      : [],
  )
}

/** Valid kinds from a comma list; anything unknown is dropped, and none means all. */
export function parseKinds(config: SearchConfig, value: string | null): SearchKind[] {
  const all = searchKinds(config).map((option) => option.kind)
  if (!value) return all
  const kinds = value.split(',').filter((kind) => all.includes(kind))
  return kinds.length ? kinds : all
}

export function parseSort(value: string | null): SearchSort {
  return SEARCH_SORTS.includes(value as SearchSort) ? (value as SearchSort) : 'best'
}
