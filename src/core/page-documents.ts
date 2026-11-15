/**
 * Which document a storefront page shows, from the same rules the Studio's Presentation tool uses
 * (`resolve.mainDocuments` / `defineDocuments`): a route such as `/products/:slug` and a GROQ
 * filter that reads the route's params (`$slug`). Pass the project's own list so the two never
 * drift. The first matching rule wins, as in Presentation.
 */

/** One `defineDocuments` entry. */
export type PageDocumentRule = {
  route: string | string[]
  filter: string
  /** Extra params for the filter, merged over the route's. */
  params?: Record<string, string>
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

/** The first rule matching `pathname`, with its params; `null` when none does. */
export function findPageDocumentRule(
  rules: PageDocumentRule[],
  pathname: string,
): {filter: string; params: Record<string, string>} | null {
  for (const rule of rules) {
    for (const route of Array.isArray(rule.route) ? rule.route : [rule.route]) {
      const params = matchRoute(route, pathname)
      if (params) return {filter: rule.filter, params: {...params, ...rule.params}}
    }
  }
  return null
}

/** The page's document as the bar receives it. */
export type PageDocument = {_id: string; _type: string}
