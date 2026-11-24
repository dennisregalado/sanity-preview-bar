import {afterEach, describe, expect, test, vi} from 'vitest'

import {matchRoute} from '../src/core/page-documents'
import {RELEASES_QUERY} from '../src/core/perspective'
import {assertLinkTtl, kvStore, memoryStore} from '../src/core/preview-links'
import {createPerspectiveSwitch} from '../src/bar/PerspectiveMenu'
import {createRefreshWaiter} from '../src/bar/refresh'
import {
  fetchCurrentUser,
  nextSession,
  openStudioSignIn,
  SessionCheckError,
  type StudioSession,
} from '../src/bar/session'
import {createPreviewBar, type PreviewClient, type PreviewContext} from '../src/server'

const ORIGIN = 'https://shop.example'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function stubWindow(extra: Record<string, unknown> = {}) {
  vi.stubGlobal('window', {
    localStorage: {getItem: () => null},
    setInterval,
    clearInterval,
    ...extra,
  })
}

describe('fetchCurrentUser', () => {
  test('null only when the API says signed out (401/403)', async () => {
    stubWindow()
    for (const code of [401, 403]) {
      vi.stubGlobal('fetch', async () => new Response('{}', {status: code}))
      expect(await fetchCurrentUser('p1')).toBeNull()
    }
  })

  test('throws on rate limits, server errors and network failures', async () => {
    stubWindow()
    for (const code of [429, 500, 503]) {
      vi.stubGlobal('fetch', async () => new Response('{}', {status: code}))
      await expect(fetchCurrentUser('p1')).rejects.toBeInstanceOf(SessionCheckError)
    }
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(fetchCurrentUser('p1')).rejects.toBeInstanceOf(SessionCheckError)
  })

  test('the user on 200', async () => {
    stubWindow()
    vi.stubGlobal('fetch', async () => Response.json({id: 'u1', name: 'Ada'}))
    expect(await fetchCurrentUser('p1')).toEqual({id: 'u1', name: 'Ada'})
  })
})

describe('nextSession', () => {
  const user = {id: 'u1'}
  const signedIn: StudioSession = {status: 'signed-in', user}

  test('a failed check keeps the last known session', () => {
    expect(nextSession(signedIn, {error: new SessionCheckError(500)})).toBe(signedIn)
    expect(nextSession({status: 'loading'}, {error: new SessionCheckError()})).toEqual({
      status: 'loading',
    })
  })

  test('a definite answer replaces it', () => {
    expect(nextSession(signedIn, {user: null})).toEqual({status: 'signed-out'})
    expect(nextSession({status: 'loading'}, {user})).toEqual(signedIn)
  })
})

describe('openStudioSignIn', () => {
  test('a blocked popup opens a tab and is done at once', () => {
    const open = vi.fn().mockReturnValueOnce(null)
    stubWindow({open})
    const onDone = vi.fn()
    const cancel = openStudioSignIn('/studio', async () => false, onDone)
    expect(open).toHaveBeenLastCalledWith('/studio', '_blank')
    expect(onDone).toHaveBeenCalledOnce()
    cancel()
  })

  test('a failing check is caught and retried; cancel stops it', async () => {
    vi.useFakeTimers()
    const popup = {closed: false, close: vi.fn()}
    stubWindow({open: () => popup, setInterval, clearInterval})
    const check = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue(false)
    const onDone = vi.fn()
    const cancel = openStudioSignIn('/studio', check, onDone)
    await vi.advanceTimersByTimeAsync(1500)
    await vi.advanceTimersByTimeAsync(1500)
    expect(check).toHaveBeenCalledTimes(2)
    cancel()
    await vi.advanceTimersByTimeAsync(4500)
    expect(check).toHaveBeenCalledTimes(2)
    expect(onDone).not.toHaveBeenCalled()
  })

  test('done once signed in', async () => {
    vi.useFakeTimers()
    const popup = {closed: false, close: vi.fn()}
    stubWindow({open: () => popup, setInterval, clearInterval})
    const onDone = vi.fn()
    openStudioSignIn('/studio', async () => true, onDone)
    await vi.advanceTimersByTimeAsync(1500)
    expect(popup.close).toHaveBeenCalled()
    expect(onDone).toHaveBeenCalledOnce()
  })
})

describe('createRefreshWaiter', () => {
  test('resolves on refreshed', async () => {
    const post = vi.fn()
    const waiter = createRefreshWaiter(post, 5000)
    const done = waiter.request()
    expect(post).toHaveBeenCalledOnce()
    waiter.settle()
    await expect(done).resolves.toBeUndefined()
  })

  test('resolves after the timeout when the page never answers', async () => {
    vi.useFakeTimers()
    const waiter = createRefreshWaiter(() => {}, 5000)
    let resolved = false
    void waiter.request().then(() => (resolved = true))
    await vi.advanceTimersByTimeAsync(4999)
    expect(resolved).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(resolved).toBe(true)
  })
})

describe('createPerspectiveSwitch', () => {
  test('a refresh that never comes back does not hold later switches', async () => {
    const posted: unknown[] = []
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as {selected: string}
      posted.push(body.selected)
      return Response.json({perspective: body.selected})
    })
    const shown: unknown[] = []
    const onRefresh = vi.fn(() => new Promise<void>(() => {}))
    const switchTo = createPerspectiveSwitch('/preview-bar', () => ({
      releases: [],
      perspective: 'drafts',
      onChange: (perspective) => shown.push(perspective),
      onRefresh,
    }))
    await switchTo({selected: 'published', excluded: []})
    await switchTo({selected: 'drafts', excluded: []})
    expect(posted).toEqual(['published', 'drafts'])
    expect(onRefresh).toHaveBeenCalledTimes(2)
    expect(shown.at(-1)).toBe('drafts')
  })

  test('a failed save puts the bar back and skips the refresh', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', async () => new Response('', {status: 500}))
    const shown: unknown[] = []
    const onRefresh = vi.fn(async () => {})
    const switchTo = createPerspectiveSwitch('/preview-bar', () => ({
      releases: [],
      perspective: 'drafts',
      onChange: (perspective) => shown.push(perspective),
      onRefresh,
    }))
    await switchTo({selected: 'published', excluded: []})
    expect(shown).toEqual(['published', 'drafts'])
    expect(onRefresh).not.toHaveBeenCalled()
  })
})

describe('perspective without release access', () => {
  function ctx(body: unknown): PreviewContext {
    const client = {
      withConfig: () => client,
      fetch: vi.fn(async (query: string) => {
        if (query === RELEASES_QUERY) throw new Error('Forbidden')
        return []
      }),
    }
    return {
      request: new Request(`${ORIGIN}/preview-bar/perspective`, {
        method: 'POST',
        headers: {origin: ORIGIN, 'content-type': 'application/json'},
        body: JSON.stringify(body),
      }),
      previewEnabled: true,
      client: client as unknown as PreviewClient,
      perspective: 'drafts',
    }
  }

  test('Published and Drafts still switch', async () => {
    const bar = createPreviewBar({brand: {title: 'Acme'}})
    for (const selected of ['published', 'drafts']) {
      const response = await bar.perspective(ctx({selected, excluded: []}))
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({perspective: selected})
    }
  })

  test('a release answers 503, not a crash', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const bar = createPreviewBar({brand: {title: 'Acme'}})
    expect((await bar.perspective(ctx({selected: 'rSpring', excluded: []}))).status).toBe(503)
  })
})

describe('matchRoute', () => {
  test('a malformed escape matches nothing', () => {
    expect(matchRoute('/products/:slug', '/products/%E0')).toBeNull()
    expect(matchRoute('/docs/:rest*', '/docs/a/%E0')).toBeNull()
    expect(matchRoute('/products/:slug', '/products/caf%C3%A9')).toEqual({slug: 'café'})
  })
})

describe('link TTL', () => {
  test('assertLinkTtl takes whole seconds from 60 up', () => {
    expect(assertLinkTtl(60)).toBe(60)
    for (const bad of [59, 0, -1, Number.NaN, 90.5, Infinity]) {
      expect(() => assertLinkTtl(bad)).toThrow(/ttlSeconds/)
    }
  })

  test('createPreviewBar rejects a bad ttlSeconds at config time', () => {
    for (const ttlSeconds of [30, 0, -5, Number.NaN]) {
      expect(() =>
        createPreviewBar({brand: {title: 'Acme'}, links: {store: memoryStore(), ttlSeconds}}),
      ).toThrow(/at least 60/)
    }
    expect(() =>
      createPreviewBar({brand: {title: 'Acme'}, links: {store: memoryStore(), ttlSeconds: 3600}}),
    ).not.toThrow()
  })

  test('kvStore refuses a TTL KV would reject', async () => {
    const put = vi.fn(async () => {})
    const store = kvStore({get: async () => null, put})
    await expect(
      store.put('k', {pathname: '/', perspective: 'drafts'} as never, 10),
    ).rejects.toThrow(/at least 60/)
    expect(put).not.toHaveBeenCalled()
  })
})
