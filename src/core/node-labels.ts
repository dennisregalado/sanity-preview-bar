/**
 * Labels for click-to-edit, and the drift check, from the Studio's schema and the document: the
 * bar (on the site, inside its Studio layer) and the Visual Editor tool answer the overlay's
 * `describe` with these, so field titles reach the page without shipping the schema there.
 *
 * A path that doesn't resolve is reported as `missing`: a field the schema doesn't have (the
 * component's annotation drifted from the schema) or an item or document that doesn't exist.
 */
import {
  describeSanityPath,
  humanizeFieldName,
  publishedDocumentId,
  type SanityNode,
  toStudioPath,
} from './sanity-node'

/** The parts of a compiled Sanity schema type the labels read. */
export type LabelSchemaType = {
  name: string
  title?: string
  jsonType?: string
  fields?: readonly {name: string; type: LabelSchemaType}[]
  of?: readonly LabelSchemaType[]
  to?: readonly LabelSchemaType[]
  options?: {list?: readonly unknown[]}
}

export type LabelSchema = {get(name: string): LabelSchemaType | undefined}

/** A node's label for the overlay, keyed by the node's `id` and `path` as the page sent them. */
export type NodeLabel = {id: string; path: string; label: string; missing?: boolean}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function typeTitle(type: LabelSchemaType) {
  return type.title || humanizeFieldName(type.name)
}

/** The array member an item uses: by its `_type`, or the only member there is. */
function memberFor(of: readonly LabelSchemaType[], item: unknown) {
  const itemType = isRecord(item) && typeof item._type === 'string' ? item._type : undefined
  return (
    (itemType && of.find((member) => member.name === itemType)) ||
    (of.length === 1 ? of[0] : undefined)
  )
}

/** A Portable Text block by its style's title (`Heading 1`), as the editor's style menu shows it. */
function blockStyleTitle(member: LabelSchemaType, item: unknown) {
  const style = isRecord(item) && typeof item.style === 'string' ? item.style : undefined
  if (!style) return undefined
  const list = member.fields?.find((field) => field.name === 'style')?.type.options?.list ?? []
  for (const option of list) {
    if (isRecord(option) && option.value === style && typeof option.title === 'string')
      return option.title
  }
  return undefined
}

function itemTitle(member: LabelSchemaType | undefined, item: unknown, field: string) {
  if (!member) return field ? `${field} item` : 'Item'
  if (member.to?.length) return typeTitle(member.to[0]!)
  if (member.name === 'block') return blockStyleTitle(member, item) ?? 'Block'
  return typeTitle(member)
}

/**
 * The label of a path's last segment, and whether the path resolves. `document` is the document's
 * value, `null` when it doesn't exist, or `undefined` when it wasn't loaded (then only the schema
 * is checked).
 */
export function describePath(
  schema: LabelSchema,
  documentType: string,
  document: unknown,
  urlPath: string,
): {label: string; missing: boolean} {
  const fallback = describeSanityPath(urlPath)
  const path = toStudioPath(urlPath)
  let type: LabelSchemaType | undefined = schema.get(documentType)
  if (!path || !type || document === null) return {label: fallback, missing: true}
  let value: unknown = document
  let label = ''
  for (const segment of path) {
    if (typeof segment === 'string') {
      const field: {name: string; type: LabelSchemaType} | undefined = type?.fields?.find(
        (candidate) => candidate.name === segment,
      )
      if (!field) return {label: humanizeFieldName(segment), missing: true}
      label = field.type.title || humanizeFieldName(segment)
      type = field.type
      value = isRecord(value) ? value[segment] : undefined
      continue
    }
    if (!type?.of) return {label, missing: true}
    const items = Array.isArray(value) ? value : undefined
    const item =
      typeof segment === 'number'
        ? items?.[segment]
        : items?.find((candidate) => isRecord(candidate) && candidate._key === segment._key)
    if (document !== undefined && item === undefined)
      return {label: label ? `${label} item` : 'Item', missing: true}
    const member = memberFor(type.of, item)
    // Without the document, an array of several types can't say which one an item is: the rest
    // of the path can't be checked, only labelled.
    if (!member && item === undefined) return {label: unresolvedLabel(path, label), missing: false}
    label = itemTitle(member, item, label)
    type = member
    value = item
  }
  return {label: label || fallback, missing: false}
}

/** The label of a path's last segment when the schema can't follow it all the way. */
function unresolvedLabel(path: readonly unknown[], label: string) {
  const last = path[path.length - 1]
  if (typeof last === 'string') return humanizeFieldName(last)
  return label ? `${label} item` : 'Item'
}

/** Fetches documents by published ID, in the editor's perspective; absent ones are left out. */
export type DocumentFetcher = (ids: string[]) => Promise<Record<string, unknown>>

/**
 * Answers the overlay's `describe`: one fetch for the documents involved (cached briefly, since
 * hovering asks a few at a time), then each node's label and drift.
 */
export function createNodeDescriber(
  schema: LabelSchema,
  fetchDocuments: DocumentFetcher,
  cacheMs = 3000,
) {
  const cache = new Map<string, {at: number; value: unknown}>()
  return async function describe(nodes: readonly SanityNode[]): Promise<NodeLabel[]> {
    const now = Date.now()
    const ids = [...new Set(nodes.map((node) => publishedDocumentId(node.id)))]
    const stale = ids.filter((id) => {
      const cached = cache.get(id)
      return !cached || now - cached.at > cacheMs
    })
    if (stale.length) {
      const fetched = await fetchDocuments(stale)
      for (const id of stale) cache.set(id, {at: now, value: fetched[id] ?? null})
    }
    return nodes.map((node) => {
      const document = cache.get(publishedDocumentId(node.id))?.value
      const {label, missing} = describePath(schema, node.type, document, node.path)
      return missing
        ? {id: node.id, path: node.path, label, missing: true}
        : {id: node.id, path: node.path, label}
    })
  }
}

type PerspectiveClient = {
  withConfig(config: {perspective: unknown}): {
    fetch(query: string, params: Record<string, unknown>, options?: unknown): Promise<unknown>
  }
}

/** A `DocumentFetcher` over a Sanity client, in a perspective stack (`['drafts']`, a release…). */
export function clientDocumentFetcher(
  client: PerspectiveClient,
  perspective: unknown,
): DocumentFetcher {
  return async (ids) => {
    const documents = await client
      .withConfig({perspective})
      .fetch('*[_id in $ids]', {ids}, {tag: 'preview-bar.node-labels'})
    const byId: Record<string, unknown> = {}
    if (Array.isArray(documents)) {
      for (const document of documents) {
        if (isRecord(document) && typeof document._id === 'string')
          byId[publishedDocumentId(document._id)] = document
      }
    }
    return byId
  }
}
