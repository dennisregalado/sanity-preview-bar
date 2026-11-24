import {fetchSharedAccessQuery} from '@sanity/preview-url-secret/constants'
import {describe, expect, test, vi} from 'vitest'

import {PERSPECTIVE_COOKIE, RELEASES_QUERY, type ReleaseDocument} from '../src/core/perspective'
import {memoryStore, previewLinkKey} from '../src/core/preview-links'
import {createPreviewBar, type PreviewClient, type PreviewContext} from '../src/server'

const ORIGIN = 'https://shop.example'

const release: ReleaseDocument = {
  _id: '_.releases.rSpring',
  _createdAt: '2026-01-01T00:00:00Z',
  state: 'active',
  metadata: {title: 'Spring', releaseType: 'asap'},
}

/** A client whose `fetch` answers by query; `withConfig` keeps the same answers. */
function fakeClient({sharing = true}: {sharing?: boolean} = {}) {
  const client = {
    withConfig: () => client,
    fetch: vi.fn(async (query: string) => {
      if (query === RELEASES_QUERY) return [release]
      if (query === fetchSharedAccessQuery) return sharing ? 'share-secret' : null
      return []
    }),
  }
  return client as unknown as PreviewClient
}

function ctx(
  init: {method?: string; body?: unknown; origin?: string; path?: string} = {},
  overrides: Partial<PreviewContext> = {},
): PreviewContext {
  const request = new Request(`${ORIGIN}${init.path ?? '/preview-bar/x'}`, {
    method: init.method ?? 'POST',
    headers: {origin: init.origin ?? ORIGIN, 'content-type': 'application/json'},
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  return {request, previewEnabled: true, client: fakeClient(), perspective: 'drafts', ...overrides}
}

const brand = {title: 'Acme'}

describe('loadBar', () => {
  test('null outside preview; otherwise brand, releases, sharing and search kinds', async () => {
    const bar = createPreviewBar({
      brand,
      search: {routes: [{title: 'Home', path: '/'}]},
      links: {store: memoryStore()},
    })
    expect(await bar.loadBar(ctx({}, {previewEnabled: false}))).toBeNull()
    const data = await bar.loadBar(ctx())
    expect(data).toMatchObject({
      brand,
      studioPath: '/studio',
      basePath: '/preview-bar',
      sharing: true,
      links: true,
      perspective: 'drafts',
      search: [{kind: 'route', title: 'Route'}],
    })
    expect(data?.releases.map((r) => r._id)).toEqual(['_.releases.rSpring'])
  })

  test('the project ID comes from the client, unless set', async () => {
    const withConfig = {...(fakeClient() as object), config: () => ({projectId: 'p1'})}
    const context = ctx({}, {client: withConfig as unknown as PreviewContext['client']})
    expect((await createPreviewBar({brand}).loadBar(context))?.projectId).toBe('p1')
    expect((await createPreviewBar({brand, projectId: 'p2'}).loadBar(context))?.projectId).toBe(
      'p2',
    )
    expect((await createPreviewBar({brand}).loadBar(ctx()))?.projectId).toBeNull()
  })

  test('without links, sharing is never read and stays off', async () => {
    const bar = createPreviewBar({brand})
    const context = ctx()
    const data = await bar.loadBar(context)
    expect(data).toMatchObject({sharing: false, links: false, search: null})
    expect(vi.mocked(context.client.fetch)).not.toHaveBeenCalledWith(fetchSharedAccessQuery)
  })
})

describe('perspective', () => {
  const bar = createPreviewBar({brand})

  test('sets the cookie from the stack built on the server', async () => {
    const response = await bar.perspective(ctx({body: {selected: 'rSpring', excluded: []}}))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({perspective: ['rSpring', 'drafts']})
    expect(response.headers.get('set-cookie')).toBe(
      `${PERSPECTIVE_COOKIE}=rSpring%2Cdrafts; Path=/; HttpOnly; SameSite=None; Secure`,
    )
  })

  test('404 outside preview, 403 cross-origin, 400 for an unknown release', async () => {
    expect((await bar.perspective(ctx({}, {previewEnabled: false}))).status).toBe(404)
    expect((await bar.perspective(ctx({origin: 'https://evil.example'}))).status).toBe(403)
    expect((await bar.perspective(ctx({body: {selected: 'rNope'}}))).status).toBe(400)
  })
})

describe('exit', () => {
  test('clears the perspective cookie and lets the adapter clear preview', async () => {
    const bar = createPreviewBar({brand})
    const response = await bar.exit(ctx(), (headers) => {
      headers.append('set-cookie', '__sanity_preview=; Max-Age=0; Path=/')
    })
    expect(response.status).toBe(204)
    const cookies = response.headers.getSetCookie()
    expect(cookies[0]).toMatch(new RegExp(`^${PERSPECTIVE_COOKIE}=; Max-Age=0`))
    expect(cookies[1]).toBe('__sanity_preview=; Max-Age=0; Path=/')
  })
})

describe('share and open', () => {
  test('mints a link that opens into preview, then expires', async () => {
    let now = Date.parse('2026-11-13T12:00:00Z')
    vi.useFakeTimers({now, toFake: ['Date']})
    const store = memoryStore(() => now)
    const bar = createPreviewBar({brand, links: {store}})

    const response = await bar.share(
      ctx({body: {pathname: '/products/box?x=1'}}, {perspective: ['rSpring', 'drafts']}),
    )
    expect(response.status).toBe(200)
    const {url, expiresAt} = (await response.json()) as {url: string; expiresAt: string}
    expect(url).toMatch(/^https:\/\/shop\.example\/p\/[A-Za-z0-9]{12}$/)
    expect(expiresAt).toBe('2026-11-15T12:00:00.000Z')

    const code = url.split('/p/')[1]
    const opened = await bar.openLink(new Request(url), code, (headers) => {
      headers.append('set-cookie', '__sanity_preview=secret; Path=/')
    })
    expect(opened.status).toBe(307)
    expect(opened.headers.get('location')).toBe('/products/box?x=1')
    expect(opened.headers.getSetCookie()).toEqual([
      `${PERSPECTIVE_COOKIE}=rSpring%2Cdrafts; Path=/; HttpOnly; SameSite=None; Secure`,
      '__sanity_preview=secret; Path=/',
    ])

    now += 2 * 24 * 60 * 60 * 1000
    expect(await bar.resolveLink(code)).toEqual({status: 404})
    vi.useRealTimers()
  })

  test('409 while sharing is off, 400 for off-site paths, 503 when the store fails', async () => {
    const failing = {
      get: async () => {
        throw new Error('no binding')
      },
      put: async () => {
        throw new Error('no binding')
      },
    }
    const bar = createPreviewBar({brand, links: {store: failing}})
    const off = await bar.share(
      ctx({body: {pathname: '/'}}, {client: fakeClient({sharing: false})}),
    )
    expect(off.status).toBe(409)
    expect((await bar.share(ctx({body: {pathname: '//evil.example'}}))).status).toBe(400)
    expect((await bar.share(ctx({body: {pathname: '/'}}))).status).toBe(503)
    expect(await bar.resolveLink('AAAAAAAAAAAA')).toEqual({status: 503})
  })

  test('a link session gets 403; editors and normal preview sessions can share', async () => {
    const bar = createPreviewBar({brand, links: {store: memoryStore()}})
    const forbidden = await bar.share(ctx({body: {pathname: '/'}}, {linkSession: true}))
    expect(forbidden.status).toBe(403)
    expect((await bar.share(ctx({body: {pathname: '/'}}, {linkSession: false}))).status).toBe(200)
    expect((await bar.share(ctx({body: {pathname: '/'}}))).status).toBe(200)
  })

  test('expiry is checked on the server, whatever the store keeps', async () => {
    const now = Date.parse('2026-11-13T12:00:00Z')
    vi.useFakeTimers({now, toFake: ['Date']})
    // A store that ignores the TTL (a Redis or database store without expiry).
    const entries = new Map<string, unknown>()
    const store = {
      get: async (key: string) => entries.get(key) ?? null,
      put: async (key: string, value: unknown) => void entries.set(key, value),
    }
    const bar = createPreviewBar({brand, links: {store, ttlSeconds: 3600}})
    const response = await bar.share(ctx({body: {pathname: '/products/box'}}))
    const code = ((await response.json()) as {url: string}).url.split('/p/')[1]

    expect(await bar.resolveLink(code)).toEqual({
      status: 200,
      link: {pathname: '/products/box', perspective: 'drafts', expiresAt: now + 3600 * 1000},
    })
    let link: {expiresAt: number} | undefined
    const opened = await bar.openLink(new Request(`${ORIGIN}/p/${code}`), code, (_h, _r, l) => {
      link = l
    })
    expect(opened.status).toBe(307)
    expect(link).toEqual({expiresAt: now + 3600 * 1000})

    vi.setSystemTime(now + 3600 * 1000)
    expect(entries.size).toBe(1)
    expect(await bar.resolveLink(code)).toEqual({status: 404})
    expect((await bar.openLink(new Request(`${ORIGIN}/p/${code}`), code, () => {})).status).toBe(
      404,
    )

    // Entries with a bad or future `createdAt` aren't ours either.
    entries.set(previewLinkKey('AAAAAAAAAAAA'), {
      pathname: '/',
      perspective: 'drafts',
      createdAt: 'x',
    })
    entries.set(previewLinkKey('BBBBBBBBBBBB'), {
      pathname: '/',
      perspective: 'drafts',
      createdAt: new Date(now + 10 * 24 * 3600 * 1000).toISOString(),
    })
    expect(await bar.resolveLink('AAAAAAAAAAAA')).toEqual({status: 404})
    expect(await bar.resolveLink('BBBBBBBBBBBB')).toEqual({status: 404})
    vi.useRealTimers()
  })

  test('unknown and malformed codes are 404 without touching the store', async () => {
    const store = memoryStore()
    const get = vi.spyOn(store, 'get')
    const bar = createPreviewBar({brand, links: {store}})
    expect(await bar.resolveLink('bad')).toEqual({status: 404})
    expect(get).not.toHaveBeenCalled()
    expect(await bar.resolveLink('AAAAAAAAAAAA')).toEqual({status: 404})
    expect(get).toHaveBeenCalledWith(previewLinkKey('AAAAAAAAAAAA'))
  })
})
