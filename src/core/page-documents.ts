/**
 * Which document a storefront page shows, with the Studio's Presentation API for it
 * (`resolve.mainDocuments` / `defineDocuments`): a route such as `/products/:slug` and either a
 * document type, a GROQ filter that reads the route's params (`$slug`), or a function returning
 * both. Pass the project's own list so the Studio and the site never drift. The first matching rule
 * wins, as in Presentation.
 */

/** What a rule's functions receive: the page's origin, its route params and its path. */
export type DocumentResolverContext = {
  origin: string
  params: Record<string, string>
  path: string
}

type ContextFn<T> = (context: DocumentResolverContext) => T

/** One `defineDocuments` entry (Presentation's `DocumentResolver`). */
export type PageDocumentRule =
  | {route: string | string[]; type: string; filter?: never; params?: never; resolve?: never}
  | {
      route: string | string[]
      type?: never
      filter: string | ContextFn<string>
      /** Extra params for the filter, merged over the route's. */
      params?: Record<string, string> | ContextFn<Record<string, string>>
      resolve?: never
    }
  | {
      route: string | string[]
      type?: never
      filter?: never
      params?: never
      resolve: ContextFn<{filter: string; params?: Record<string, string>} | undefined>
    }

/**
 * Matches `pathname` against a Presentation route: literal segments, `:name` params (one segment)
 * and a trailing `:name*` (the rest of the path). Returns the params, or `null`.
 */
export function matchRoute(route: string, pathname: string): Record<string, string> | null {
  const routeParts = route.split('/').filter(Boolean)
  const pathParts = pathname.split('?')[0].split('#')[0].split('/').filter(Boolean)
  const params: Record<string, string> = {}
  for (let index = 0; index < routeParts.length; index++) {
    const part = routeParts[index]
    if (part.startsWith(':') && part.endsWith('*')) {
      params[part.slice(1, -1)] = pathParts.slice(index).map(decodeURIComponent).join('/')
      return params
    }
    const value = pathParts[index]
    if (value === undefined) return null
    if (part.startsWith(':')) params[part.slice(1)] = decodeURIComponent(value)
    else if (part !== value) return null
  }
  return routeParts.length === pathParts.length ? params : null
}

/** The first rule matching `pathname`, as a filter with its params; `null` when none does. */
export function findPageDocumentRule(
  rules: PageDocumentRule[],
  pathname: string,
  origin = '',
): {filter: string; params: Record<string, string>} | null {
  const path = pathname.split('?')[0].split('#')[0]
  for (const rule of rules) {
    for (const route of Array.isArray(rule.route) ? rule.route : [rule.route]) {
      const params = matchRoute(route, pathname)
      if (!params) continue
      const context = {origin, params, path}
      if (rule.type) return {filter: '_type == $type', params: {...params, type: rule.type}}
      if (rule.resolve) {
        const resolved = rule.resolve(context)
        if (resolved) return {filter: resolved.filter, params: {...params, ...resolved.params}}
        continue
      }
      if (rule.filter) {
        const filter = typeof rule.filter === 'function' ? rule.filter(context) : rule.filter
        const extra = typeof rule.params === 'function' ? rule.params(context) : rule.params
        return {filter, params: {...params, ...extra}}
      }
    }
  }
  return null
}

/** The page's document as the bar receives it. */
export type PageDocument = {_id: string; _type: string}
