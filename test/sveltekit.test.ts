import type {RequestEvent} from '@sveltejs/kit'
import {afterEach, describe, expect, test, vi} from 'vitest'

import {RELEASES_QUERY} from '../src/core/perspective'
import {memoryStore} from '../src/core/preview-links'
import {createPreviewBar, type PreviewClient} from '../src/server'
import {createSvelteKitPreviewBar} from '../src/sveltekit'

const ORIGIN = 'https://shop.example'
const SECRET = 'master-preview-secret'

type Client = PreviewClient & {settings: Record<string, unknown>}

function fakeClient(settings: Record<string, unknown> = {}): Client {
  return {
    settings,
    withConfig: (next: Record<string, unknown>) => fakeClient({...settings, ...next}),
    fetch: async (query: string) => (query === RELEASES_QUERY ? [] : 'share-secret'),
  } as unknown as Client
}

/** What `handlePreviewMode` and `previewBar.handle` left on `event.locals.sanity`. */
function sanityOf(event: RequestEvent) {
  return (event.locals as {sanity: {previewEnabled: boolean; client: Client}}).sanity
}

type Cookie = {value: string; options?: Record<string, unknown>}

/** A RequestEvent after `handlePreviewMode`: preview is on only with the right secret. */
function fakeEvent(path: string, jar = new Map<string, Cookie>(), init: RequestInit = {}) {
  const set = new Map<string, Cookie>()
  const event = {
    url: new URL(path, ORIGIN),
    request: new Request(new URL(path, ORIGIN), init),
    params: {code: path.split('/p/')[1]},
    locals: {
      sanity: {
        previewEnabled: jar.get('__sanity_preview')?.value === SECRET,
        client: fakeClient(),
      },
    } as Record<string, unknown>,
    cookies: {
      get: (name: string) => jar.get(name)?.value,
      set: (name: string, value: string, options: Record<string, unknown>) => {
        set.set(name, {value, options})
      },
    },
    setHeaders: () => {},
  }
  return {event: event as unknown as RequestEvent & {params: {code?: string}}, set}
}

async function caught(promise: unknown) {
  try {
    await promise
  } catch (err) {
    return err as {status: number; location?: string}
  }
  throw new Error('expected a throw')
}

const resolve = () => new Response('ok')

afterEach(() => {
  vi.useRealTimers()
})

describe('createSvelteKitPreviewBar short links', () => {
  async function setup() {
    const now = Date.parse('2026-11-13T12:00:00Z')
    vi.useFakeTimers({now, toFake: ['Date']})
    const bar = createPreviewBar({brand: {title: 'Acme'}, links: {store: memoryStore()}})
    const kit = createSvelteKitPreviewBar({bar, previewSecret: SECRET})
    // An editor (with the preview secret) mints a link.
    const editor = fakeEvent(
      '/preview-bar/share',
      new Map([['__sanity_preview', {value: SECRET}]]),
      {
        method: 'POST',
        headers: {origin: ORIGIN},
        body: JSON.stringify({pathname: '/products/oil'}),
      },
    )
    await kit.handle({event: editor.event, resolve})
    const shared = await kit.share(editor.event)
    expect(shared.status).toBe(200)
    const code = ((await shared.json()) as {url: string}).url.split('/p/')[1]
    return {now, kit, code}
  }

  test('opening a link sets a signed, expiring cookie, never the preview secret', async () => {
    const {now, kit, code} = await setup()
    vi.setSystemTime(now + 60 * 60 * 1000)
    const visitor = fakeEvent(`/p/${code}`)
    await kit.handle({event: visitor.event, resolve})
    const thrown = await caught(kit.openLink(visitor.event))
    expect(thrown).toMatchObject({status: 307, location: '/products/oil'})

    expect(visitor.set.has('__sanity_preview')).toBe(false)
    for (const cookie of visitor.set.values()) expect(cookie.value).not.toContain(SECRET)
    const session = visitor.set.get('__sanity_preview_link')!
    expect(session.options).toMatchObject({httpOnly: true, secure: true, maxAge: 47 * 60 * 60})
    expect(session.value).toMatch(/^\d+\.[A-Za-z0-9_-]+$/)
  })

  test('the link cookie turns preview on until the link expires, and cannot share', async () => {
    const {now, kit, code} = await setup()
    const visitor = fakeEvent(`/p/${code}`)
    await kit.handle({event: visitor.event, resolve})
    await caught(kit.openLink(visitor.event))
    const jar = new Map([['__sanity_preview_link', visitor.set.get('__sanity_preview_link')!]])

    const page = fakeEvent('/products/oil', jar)
    await kit.handle({event: page.event, resolve})
    const sanity = sanityOf(page.event)
    expect(sanity.previewEnabled).toBe(true)
    expect(sanity.client.settings).toMatchObject({useCdn: false, stega: false})

    const share = fakeEvent('/preview-bar/share', jar, {
      method: 'POST',
      headers: {origin: ORIGIN},
      body: JSON.stringify({pathname: '/'}),
    })
    await kit.handle({event: share.event, resolve})
    expect((await kit.share(share.event)).status).toBe(403)

    // Past the link's lifetime the cookie is worthless, even if the browser kept it.
    vi.setSystemTime(now + 2 * 24 * 60 * 60 * 1000)
    const later = fakeEvent('/products/oil', jar)
    await kit.handle({event: later.event, resolve})
    expect(sanityOf(later.event).previewEnabled).toBe(false)
  })

  test('a forged link cookie does nothing; an editor who opened a link can still share', async () => {
    const {kit, code} = await setup()
    const forged = fakeEvent(
      '/products/oil',
      new Map([['__sanity_preview_link', {value: `${2 ** 40}.AAAA`}]]),
    )
    await kit.handle({event: forged.event, resolve})
    expect(sanityOf(forged.event).previewEnabled).toBe(false)

    const jar = new Map([['__sanity_preview', {value: SECRET}]])
    const opened = fakeEvent(`/p/${code}`, jar)
    await kit.handle({event: opened.event, resolve})
    await caught(kit.openLink(opened.event))
    jar.set('__sanity_preview_link', opened.set.get('__sanity_preview_link')!)
    const share = fakeEvent('/preview-bar/share', jar, {
      method: 'POST',
      headers: {origin: ORIGIN},
      body: JSON.stringify({pathname: '/'}),
    })
    await kit.handle({event: share.event, resolve})
    expect((await kit.share(share.event)).status).toBe(200)
  })

  test('exit clears the link cookie too; openLink without the hook fails loudly', async () => {
    const {kit, code} = await setup()
    const exit = await kit.exit(
      fakeEvent('/preview-bar/exit', new Map(), {method: 'POST', headers: {origin: ORIGIN}}).event,
    )
    expect(exit.headers.getSetCookie().map((cookie) => cookie.split('=')[0])).toEqual([
      'sanity-preview-perspective',
      '__sanity_preview',
      '__sanity_preview_link',
    ])
    await expect(kit.openLink(fakeEvent(`/p/${code}`).event)).rejects.toThrow(/previewBar\.handle/)
  })
})
