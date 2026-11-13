/**
 * The bar's server side, framework-neutral: each handler takes a web `Request` plus the request's
 * preview state and returns a web `Response`. Framework adapters (`sanity-preview-bar/sveltekit`,
 * later `/next`) supply that state and the one thing that differs per framework: turning preview
 * mode on and off.
 */
import {fetchSharedAccessQuery} from '@sanity/preview-url-secret/constants'

import type {PreviewBarBrand, PreviewBarData} from '../core/data'
import {
  buildSearchQuery,
  documentResult,
  parseKinds,
  parseSort,
  prefixLast,
  ROUTE_KIND,
  routeResults,
  SEARCH_PAGE_SIZE,
  type SearchConfig,
  type SearchDocument,
  searchKinds,
  type SearchResult,
  versionIds,
} from '../core/link-search'
import {
  activeReleases,
  DRAFTS,
  PERSPECTIVE_COOKIE,
  perspectiveStack,
  type PreviewPerspective,
  PUBLISHED,
  RELEASES_QUERY,
  type ReleaseDocument,
  releaseIdOf,
  serializePerspective,
  parsePerspective,
} from '../core/perspective'
import {
  createPreviewLink,
  generatePreviewLinkCode,
  isPreviewLinkCode,
  normalizePreviewPathname,
  parsePreviewLinkValue,
  PREVIEW_LINK_ROUTE,
  PREVIEW_LINK_TTL_SECONDS,
  type PreviewLinkStore,
  previewLinkKey,
} from '../core/preview-links'
import {PREVIEW_BAR_ROUTE} from '../core/protocol'

export type PreviewBarOptions = {
  brand: PreviewBarBrand
  /** Where the embedded Studio lives. Default `/studio`. */
  studioPath?: string
  /** The bar's route. Default `/preview-bar`. */
  basePath?: string
  /** Link search; `false` or omitted hides the search button. */
  search?: SearchConfig | false
  /** Short expiring links; `false` or omitted keeps Presentation's own shared link. */
  links?:
    | {
        /** A store, or a function returning one per request (for runtime bindings such as KV). */
        store: PreviewLinkStore | (() => PreviewLinkStore)
        /** Route prefix the links open at. Default `/p/`. */
        route?: string
        /** Default 2 days. */
        ttlSeconds?: number
      }
    | false
}

/**
 * The slice of `@sanity/client`'s `SanityClient` the bar uses. Structural, so any client version
 * fits and the package carries none of its types.
 */
export type PreviewClient = {
  withConfig(config: {
    apiVersion?: string
    perspective?: PreviewPerspective | 'raw'
    useCdn?: boolean
    stega?: boolean
  }): PreviewClient
  fetch<R = unknown>(
    query: string,
    params?: Record<string, unknown>,
    options?: {tag?: string},
  ): Promise<R>
}

/** The request's preview state, as the framework adapter knows it. */
export type PreviewContext = {
  request: Request
  /** Preview mode is on (the preview cookie, or Next.js draft mode, is valid). */
  previewEnabled: boolean
  /**
   * A server Sanity client with a read token. Its perspective doesn't matter: handlers set what
   * they need per query.
   */
  client: PreviewClient
  /** The perspective the request applies (the parsed perspective cookie). */
  perspective: PreviewPerspective
}

/** Adds or removes the framework's preview cookie on a response (e.g. `__sanity_preview`). */
export type PreviewModeSwitch = (headers: Headers, request: Request) => void | Promise<void>

const PRIVATE_HEADERS = {'cache-control': 'private, no-store', 'x-robots-tag': 'noindex'}

function json(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json')
  for (const [key, value] of Object.entries(PRIVATE_HEADERS)) headers.set(key, value)
  return new Response(JSON.stringify(body), {...init, headers})
}

function status(code: number, message: string) {
  return json({message}, {status: code})
}

function sameOrigin(request: Request) {
  return request.headers.get('origin') === new URL(request.url).origin
}

/**
 * `handlePreviewMode`'s cookie attributes: `SameSite=None; Secure` so the cookies also work inside
 * the Studio's Presentation iframe, `Lax` on plain-HTTP local development.
 */
export function previewCookieAttributes(request: Request) {
  const secure = new URL(request.url).protocol === 'https:'
  return secure ? 'Path=/; HttpOnly; SameSite=None; Secure' : 'Path=/; HttpOnly; SameSite=Lax'
}

export function setCookieHeader(request: Request, name: string, value: string) {
  return `${name}=${encodeURIComponent(value)}; ${previewCookieAttributes(request)}`
}

export function deleteCookieHeader(request: Request, name: string) {
  return `${name}=; Max-Age=0; ${previewCookieAttributes(request)}`
}

/**
 * Every content release, read like the Studio's releases store: raw perspective, the API version
 * that introduced releases, no stega or CDN. The client's token needs read access to
 * `system.release` documents.
 */
export function fetchReleases(client: PreviewClient) {
  return client
    .withConfig({apiVersion: '2025-02-19', perspective: 'raw', useCdn: false, stega: false})
    .fetch<ReleaseDocument[] | null>(RELEASES_QUERY)
    .then((releases) => releases ?? [])
}

function rawClient(client: PreviewClient) {
  return client.withConfig({perspective: 'raw', useCdn: false, stega: false})
}

export function createPreviewBar(options: PreviewBarOptions) {
  const studioPath = options.studioPath ?? '/studio'
  const basePath = options.basePath ?? PREVIEW_BAR_ROUTE
  const search = options.search || null
  const links = options.links || null
  const linkRoute = links ? (links.route ?? PREVIEW_LINK_ROUTE) : PREVIEW_LINK_ROUTE
  const ttlSeconds = links ? (links.ttlSeconds ?? PREVIEW_LINK_TTL_SECONDS) : 0

  function store() {
    if (!links) throw new Error('sanity-preview-bar: short links are not configured')
    return typeof links.store === 'function' ? links.store() : links.store
  }

  /** The bar page's data, or `null` outside preview (render a 404). */
  async function loadBar(ctx: PreviewContext): Promise<PreviewBarData | null> {
    if (!ctx.previewEnabled) return null
    const [releasesResult, shareSecretResult] = await Promise.allSettled([
      fetchReleases(ctx.client),
      // Presentation's "Share this preview" secret exists only while an editor has sharing on.
      // The bar only learns whether it exists; links are minted server-side.
      links
        ? rawClient(ctx.client).fetch<string | null>(fetchSharedAccessQuery)
        : Promise.resolve(null),
    ])
    if (releasesResult.status === 'rejected') {
      console.error('sanity-preview-bar: could not load content releases', releasesResult.reason)
    }
    if (shareSecretResult.status === 'rejected') {
      console.error(
        'sanity-preview-bar: could not read the preview share secret',
        shareSecretResult.reason,
      )
    }
    return {
      brand: options.brand,
      studioPath,
      basePath,
      releases: releasesResult.status === 'fulfilled' ? activeReleases(releasesResult.value) : [],
      releasesError: releasesResult.status === 'rejected',
      sharing: shareSecretResult.status === 'fulfilled' && Boolean(shareSecretResult.value),
      links: Boolean(links),
      perspective: serializePerspective(ctx.perspective),
      search: search ? searchKinds(search) : null,
    }
  }

  /**
   * POST `{ selected, excluded }`: sets the perspective cookie. The stack is built here from fresh
   * release data, so the client only names a layer to select and layers to hide.
   */
  async function perspective(ctx: PreviewContext): Promise<Response> {
    if (!ctx.previewEnabled) return status(404, 'Not found')
    if (!sameOrigin(ctx.request)) return status(403, 'Forbidden')
    const body = (await ctx.request.json().catch(() => ({}))) as {
      selected?: unknown
      excluded?: unknown
    }
    const releases = activeReleases(await fetchReleases(ctx.client))
    const releaseIds = releases.map(releaseIdOf)
    const selected = typeof body.selected === 'string' ? body.selected : DRAFTS
    if (selected !== PUBLISHED && selected !== DRAFTS && !releaseIds.includes(selected)) {
      return status(400, 'Unknown perspective')
    }
    const excluded = Array.isArray(body.excluded)
      ? body.excluded.filter(
          (name): name is string =>
            typeof name === 'string' && (name === DRAFTS || releaseIds.includes(name)),
        )
      : []
    const stack = perspectiveStack({selected, releases, excluded})
    return json(
      {perspective: stack},
      {
        headers: {
          'set-cookie': setCookieHeader(
            ctx.request,
            PERSPECTIVE_COOKIE,
            serializePerspective(stack),
          ),
        },
      },
    )
  }

  /**
   * POST: ends preview mode in place. Clears the perspective cookie; `disablePreview` clears the
   * framework's preview cookie. The bar then asks the host to rerun its data, so no reload.
   */
  async function exit(
    ctx: Pick<PreviewContext, 'request'>,
    disablePreview: PreviewModeSwitch,
  ): Promise<Response> {
    if (!sameOrigin(ctx.request)) return status(403, 'Forbidden')
    const headers = new Headers(PRIVATE_HEADERS)
    headers.append('set-cookie', deleteCookieHeader(ctx.request, PERSPECTIVE_COOKIE))
    await disablePreview(headers, ctx.request)
    return new Response(null, {status: 204, headers})
  }

  /** GET `?q=&kinds=&sort=&offset=`: `{ results, nextOffset }`. Fixed routes come first. */
  async function searchLinks(ctx: PreviewContext): Promise<Response> {
    if (!ctx.previewEnabled || !search) return status(404, 'Not found')
    const url = new URL(ctx.request.url)
    const raw = (url.searchParams.get('q') ?? '').trim().slice(0, 200)
    const kinds = parseKinds(search, url.searchParams.get('kinds'))
    const sort = parseSort(url.searchParams.get('sort'))
    const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') ?? '0', 10) || 0)
    const types = kinds.filter((kind) => kind !== ROUTE_KIND)

    const results: SearchResult[] =
      offset === 0 && kinds.includes(ROUTE_KIND) ? routeResults(search, raw) : []
    let nextOffset: number | null = null

    if (types.length > 0) {
      // The request's own perspective (drafts, published or a release stack), without stega.
      const client = ctx.client.withConfig({
        perspective: ctx.perspective,
        stega: false,
        useCdn: false,
      })
      const docs = await client.fetch<SearchDocument[]>(
        buildSearchQuery({config: search, types, hasQuery: raw.length > 0, sort}),
        {types, q: prefixLast(raw), raw, start: offset, end: offset + SEARCH_PAGE_SIZE},
        {tag: 'preview-bar.search'},
      )
      // One raw lookup for which published and draft IDs exist, so rows show both indicators.
      const existing = new Set(
        docs.length
          ? await rawClient(ctx.client).fetch<string[]>('*[_id in $ids]._id', {
              ids: versionIds(docs),
            })
          : [],
      )
      for (const doc of docs) {
        const result = documentResult(search, doc, existing)
        if (result) results.push(result)
      }
      if (docs.length === SEARCH_PAGE_SIZE) nextOffset = offset + SEARCH_PAGE_SIZE
    }
    return json({results, nextOffset})
  }

  /**
   * POST `{ pathname }`: mints a short link while Presentation's "Share this preview" is on (409
   * when it is off). The store holds the page and perspective, never a secret.
   */
  async function share(ctx: PreviewContext): Promise<Response> {
    if (!ctx.previewEnabled || !links) return status(404, 'Not found')
    if (!sameOrigin(ctx.request)) return status(403, 'Forbidden')
    const body = (await ctx.request.json().catch(() => ({}))) as {pathname?: unknown}
    const pathname = normalizePreviewPathname(body?.pathname)
    if (!pathname) return status(400, 'Invalid pathname')
    const shareSecret = await rawClient(ctx.client).fetch<string | null>(fetchSharedAccessQuery)
    if (!shareSecret) return status(409, 'Preview sharing is off')
    const link = createPreviewLink({
      code: generatePreviewLinkCode(),
      pathname,
      perspective: serializePerspective(ctx.perspective),
      ttlSeconds,
      route: linkRoute,
    })
    try {
      await store().put(link.key, link.value, link.ttlSeconds)
    } catch (err) {
      console.error('sanity-preview-bar: could not store a preview link', err)
      return status(503, 'Preview links are not configured')
    }
    return json({url: new URL(link.path, ctx.request.url).href, expiresAt: link.expiresAt})
  }

  /**
   * Opens `/p/<code>`: a 307 to the stored page with the perspective cookie and, through
   * `enablePreview`, the framework's preview cookie. 404 for an unknown, malformed or expired
   * code; 503 when the store can't be read. Render your expired-link page for those two.
   */
  async function openLink(
    request: Request,
    code: string,
    enablePreview: PreviewModeSwitch,
  ): Promise<Response> {
    const result = await resolveLink(code)
    if (result.status !== 200) {
      return status(result.status, result.status === 404 ? 'Preview link not found' : 'Unavailable')
    }
    const {link} = result
    const headers = new Headers(PRIVATE_HEADERS)
    headers.set('location', link.pathname)
    headers.append(
      'set-cookie',
      setCookieHeader(request, PERSPECTIVE_COOKIE, serializePerspective(link.perspective)),
    )
    await enablePreview(headers, request)
    return new Response(null, {status: 307, headers})
  }

  /**
   * Looks a short link up: `200` with the stored page and perspective, `404` for an unknown,
   * malformed or expired code, `503` when the store can't be read. For adapters that set cookies
   * through their framework's own API; `openLink` builds the whole response.
   */
  async function resolveLink(
    code: string,
  ): Promise<
    {status: 200; link: {pathname: string; perspective: PreviewPerspective}} | {status: 404 | 503}
  > {
    if (!links || !isPreviewLinkCode(code)) return {status: 404}
    let stored: unknown
    try {
      stored = await store().get(previewLinkKey(code))
    } catch (err) {
      console.error('sanity-preview-bar: could not read a preview link', err)
      return {status: 503}
    }
    const link = parsePreviewLinkValue(stored)
    if (!link) return {status: 404}
    return {
      status: 200,
      link: {pathname: link.pathname, perspective: parsePerspective(link.perspective)},
    }
  }

  return {
    options: {...options, studioPath, basePath, linkRoute},
    resolveLink,
    loadBar,
    perspective,
    exit,
    search: searchLinks,
    share,
    openLink,
  }
}

export type PreviewBar = ReturnType<typeof createPreviewBar>

export {kvStore, memoryStore} from '../core/preview-links'
export type {KVNamespaceLike, PreviewLinkStore} from '../core/preview-links'
export type {SearchConfig, SearchDocumentType, SearchRoute} from '../core/link-search'
export type {PreviewBarBrand, PreviewBarData} from '../core/data'
