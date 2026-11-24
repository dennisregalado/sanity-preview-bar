import {beforeEach, describe, expect, test, vi} from 'vitest'

import {RELEASES_QUERY} from '../src/core/perspective'
import {memoryStore} from '../src/core/preview-links'
import {createPreviewBar, type PreviewClient} from '../src/server'

const state = vi.hoisted(() => ({
  draft: true,
  cookies: new Map<string, string>(),
  set: [] as {name: string; value: string; options: unknown}[],
  deleted: [] as string[],
  enabled: 0,
  disabled: 0,
}))

vi.mock('next/headers', () => ({
  draftMode: async () => ({
    isEnabled: state.draft,
    enable: () => {
      state.enabled++
      // Next's mutable cookies: what `enable()` sets, `cookies().get` reads back.
      state.cookies.set('__prerender_bypass', 'build-preview-id')
    },
    disable: () => {
      state.disabled++
    },
  }),
  cookies: async () => ({
    get: (name: string) =>
      state.cookies.has(name) ? {name, value: state.cookies.get(name)} : undefined,
    set: (name: string, value: string, options: unknown) => state.set.push({name, value, options}),
    delete: (name: string) => state.deleted.push(name),
  }),
  headers: async () => new Headers({host: 'shop.example', 'x-forwarded-proto': 'https'}),
}))

class Thrown extends Error {
  constructor(
    readonly kind: string,
    readonly target?: string,
  ) {
    super(kind)
  }
}
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Thrown('notFound')
  },
  redirect: (target: string) => {
    throw new Thrown('redirect', target)
  },
}))

const {createNextPreviewBar} = await import('../src/next')

const client = {
  withConfig: () => client,
  fetch: async (query: string) => (query === RELEASES_QUERY ? [] : 'share-secret'),
} as unknown as PreviewClient

const params = (values: Record<string, string>) => ({params: Promise.resolve(values)})

async function thrown(promise: Promise<unknown>) {
  try {
    await promise
  } catch (err) {
    return err as Thrown
  }
  throw new Error('expected a throw')
}

describe('createNextPreviewBar', () => {
  beforeEach(() => {
    state.draft = true
    state.cookies.clear()
    state.set = []
    state.deleted = []
    state.enabled = 0
    state.disabled = 0
  })

  test('loadBar reads draft mode and the perspective cookie; 404 outside draft mode', async () => {
    state.cookies.set('sanity-preview-perspective', 'published')
    const next = createNextPreviewBar({bar: createPreviewBar({brand: {title: 'Acme'}}), client})
    expect(await next.loadBar()).toMatchObject({perspective: 'published', brand: {title: 'Acme'}})
    state.draft = false
    expect((await thrown(next.loadBar())).kind).toBe('notFound')
  })

  test('handlers dispatch by action; exit disables draft mode', async () => {
    const next = createNextPreviewBar({bar: createPreviewBar({brand: {title: 'Acme'}}), client})
    const exit = await next.handlers.POST(
      new Request('https://shop.example/preview-bar/exit', {
        method: 'POST',
        headers: {origin: 'https://shop.example'},
      }),
      params({action: 'exit'}),
    )
    expect(exit.status).toBe(204)
    expect(state.disabled).toBe(1)
    expect(state.deleted).toEqual(['__sanity_preview_link'])
    const unknown = await next.handlers.GET(
      new Request('https://shop.example/preview-bar/nope'),
      params({action: 'nope'}),
    )
    expect(unknown.status).toBe(404)
  })

  test('a live link redirects to open, which enables draft mode until it expires', async () => {
    const now = Date.parse('2026-11-13T12:00:00Z')
    vi.useFakeTimers({now, toFake: ['Date']})
    const store = memoryStore()
    const bar = createPreviewBar({brand: {title: 'Acme'}, links: {store}})
    const next = createNextPreviewBar({bar, client})
    const minted = await bar.share({
      request: new Request('https://shop.example/preview-bar/share', {
        method: 'POST',
        headers: {origin: 'https://shop.example'},
        body: JSON.stringify({pathname: '/products/oil'}),
      }),
      previewEnabled: true,
      client,
      perspective: ['rSpring', 'drafts'],
    })
    const code = ((await minted.json()) as {url: string}).url.split('/p/')[1]

    const check = await thrown(next.checkLink(code))
    expect(check).toMatchObject({kind: 'redirect', target: `/preview-bar/open/${code}`})

    // An hour later, someone outside draft mode opens it.
    vi.setSystemTime(now + 60 * 60 * 1000)
    state.draft = false
    const open = await thrown(
      next.openLink(new Request(`https://shop.example/preview-bar/open/${code}`), params({code})),
    )
    expect(open).toMatchObject({kind: 'redirect', target: '/products/oil'})
    expect(state.enabled).toBe(1)
    const options = {httpOnly: true, path: '/', sameSite: 'none', secure: true}
    const maxAge = 47 * 60 * 60
    expect(state.set).toEqual([
      {name: '__prerender_bypass', value: 'build-preview-id', options: {...options, maxAge}},
      {
        name: '__sanity_preview_link',
        value: String((now + 2 * 24 * 60 * 60 * 1000) / 1000),
        options: {...options, maxAge},
      },
      {name: 'sanity-preview-perspective', value: 'rSpring,drafts', options},
    ])
    vi.useRealTimers()
  })

  test('an editor already in draft mode opens a link without being marked', async () => {
    const store = memoryStore()
    const bar = createPreviewBar({brand: {title: 'Acme'}, links: {store}})
    const next = createNextPreviewBar({bar, client})
    const minted = await bar.share({
      request: new Request('https://shop.example/preview-bar/share', {
        method: 'POST',
        headers: {origin: 'https://shop.example'},
        body: JSON.stringify({pathname: '/'}),
      }),
      previewEnabled: true,
      client,
      perspective: 'drafts',
    })
    const code = ((await minted.json()) as {url: string}).url.split('/p/')[1]
    await thrown(
      next.openLink(new Request(`https://shop.example/preview-bar/open/${code}`), params({code})),
    )
    expect(state.enabled).toBe(0)
    expect(state.set.map((cookie) => cookie.name)).toEqual(['sanity-preview-perspective'])
  })

  test('share is 403 for a session opened from a link, and allowed once the marker expires', async () => {
    const bar = createPreviewBar({brand: {title: 'Acme'}, links: {store: memoryStore()}})
    const next = createNextPreviewBar({bar, client})
    const share = () =>
      next.handlers.POST(
        new Request('https://shop.example/preview-bar/share', {
          method: 'POST',
          headers: {origin: 'https://shop.example'},
          body: JSON.stringify({pathname: '/'}),
        }),
        params({action: 'share'}),
      )
    state.cookies.set('__sanity_preview_link', String(Math.floor(Date.now() / 1000) + 3600))
    expect((await share()).status).toBe(403)
    state.cookies.set('__sanity_preview_link', String(Math.floor(Date.now() / 1000) - 1))
    expect((await share()).status).toBe(200)
    state.cookies.delete('__sanity_preview_link')
    expect((await share()).status).toBe(200)
  })

  test('dead links are notFound; open sends a dead link back to /p/', async () => {
    const next = createNextPreviewBar({
      bar: createPreviewBar({brand: {title: 'Acme'}, links: {store: memoryStore()}}),
      client,
    })
    expect((await thrown(next.checkLink('AAAAAAAAAAAA'))).kind).toBe('notFound')
    const open = await thrown(
      next.openLink(
        new Request('https://shop.example/preview-bar/open/AAAAAAAAAAAA'),
        params({code: 'AAAAAAAAAAAA'}),
      ),
    )
    expect(open).toMatchObject({kind: 'redirect', target: '/p/AAAAAAAAAAAA'})
    expect(state.enabled).toBe(0)
  })
})
