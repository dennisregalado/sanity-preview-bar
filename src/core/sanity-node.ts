/**
 * The `data-sanity` attribute that marks an element as editable, and its path, without
 * dependencies. Storefronts write it with `createDataAttribute({id, type, path})` or by hand:
 *
 *     data-sanity="id=page-home;type=page;path=sections:k1.heading"
 *
 * `base=` and `workspace=` may follow; they're read but unused. `path` is Sanity's URL path form:
 * `.` between segments, `field:key` for a keyed array item, and `field:3` (up to 9 digits) for an
 * index, so `sections:k1.heading` is `sections[_key=="k1"].heading`.
 */

export const SANITY_NODE_ATTRIBUTE = 'data-sanity'

/** An editable element's document and path (URL form, as written in the attribute). */
export type SanityNode = {
  id: string
  type: string
  path: string
  base?: string
  workspace?: string
}

/** A Studio path: field names, keyed array items and indexes. */
export type StudioPathSegment = string | number | {_key: string}
export type StudioPath = StudioPathSegment[]

/** Longest path the edit message carries. */
export const MAX_EDIT_PATH_LENGTH = 1000

const INDEX = /^\d{1,9}$/

function decode(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

/**
 * Reads a `data-sanity` value: pairs split on `;`, each on its first `=`, values URI-decoded.
 * Returns `null` unless `id`, `type` and `path` are all present and non-empty.
 */
export function parseSanityNode(value: string | null | undefined): SanityNode | null {
  if (!value) return null
  const fields: Record<string, string> = {}
  for (const pair of value.split(';')) {
    const separator = pair.indexOf('=')
    if (separator < 0) continue
    const key = pair.slice(0, separator).trim()
    const decoded = decode(pair.slice(separator + 1))
    if (!key || decoded === null) continue
    fields[key] = decoded
  }
  const {id, type, path, base, workspace} = fields
  if (!id || !type || !path || path.length > MAX_EDIT_PATH_LENGTH) return null
  const node: SanityNode = {id, type, path}
  if (base) node.base = base
  if (workspace) node.workspace = workspace
  return node
}

/**
 * Sanity's URL path form to a Studio path: `sections:k1.heading` →
 * `['sections', {_key: 'k1'}, 'heading']`, `items:3` → `['items', 3]`. Chained items
 * (`rows:r1:c2`) are nested arrays. Returns `null` for an empty or malformed path.
 */
export function toStudioPath(urlPath: string): StudioPath | null {
  if (!urlPath) return null
  const path: StudioPath = []
  for (const segment of urlPath.split('.')) {
    const [field, ...items] = segment.split(':')
    if (!field) return null
    path.push(field)
    for (const item of items) {
      if (!item) return null
      path.push(INDEX.test(item) ? Number(item) : {_key: item})
    }
  }
  return path
}

/**
 * A Studio path as the document pane's `path` param reads it (`@sanity/util/paths` `toString`):
 * `sections[_key=="k1"].heading`, `items[3]`.
 */
export function studioPathToString(path: StudioPath): string {
  let result = ''
  for (const segment of path) {
    if (typeof segment === 'string') result += result ? `.${segment}` : segment
    else if (typeof segment === 'number') result += `[${segment}]`
    else result += `[_key=="${segment._key}"]`
  }
  return result
}

/** The pane param for a URL-form path, or `null` when it doesn't parse. */
export function toPanePath(urlPath: string): string | null {
  const path = toStudioPath(urlPath)
  return path ? studioPathToString(path) : null
}

/** `heroImage` → `Hero image`, `section_title` → `Section title`. */
export function humanizeFieldName(name: string): string {
  const words = name
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter(Boolean)
  if (!words.length) return name
  return words
    .map((word, index) => {
      // Acronyms (`SEO`, `CTA`) keep their case.
      if (word.length > 1 && word === word.toUpperCase()) return word
      const lower = word.toLowerCase()
      return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower
    })
    .join(' ')
}

/**
 * A label for a path's last segment: the field's name, humanized (`sections:k1.heading` →
 * `Heading`), or `Sections item` when it ends in an array item.
 */
export function describeSanityPath(urlPath: string): string {
  const path = toStudioPath(urlPath)
  if (!path?.length) return urlPath
  const last = path[path.length - 1]!
  if (typeof last === 'string') return humanizeFieldName(last)
  for (let index = path.length - 1; index >= 0; index--) {
    const segment = path[index]
    if (typeof segment === 'string') return `${humanizeFieldName(segment)} item`
  }
  return urlPath
}
