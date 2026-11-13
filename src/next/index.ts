/**
 * Next.js (App Router) adapter, for sites using `next-sanity`'s draft mode. Server side: route
 * handlers, the bar page's data and the short-link checks. The client components live in
 * `sanity-preview-bar/next/client`. See the README for the routes.
 *
 * Opening a short link takes two steps because a page can't set cookies while it renders:
 * `/p/[code]` checks the link (rendering the expired page with a 404 when it's gone) and redirects
 * live ones to `<basePath>/open/<code>`, a route handler that turns draft mode on and redirects to
 * the stored page.
 */
import {cookies, draftMode, headers} from 'next/headers'
import {notFound, redirect} from 'next/navigation'

import type {PreviewBarData} from '../core/data'
import {parsePerspective, PERSPECTIVE_COOKIE, serializePerspective} from '../core/perspective'
import type {PreviewBar, PreviewClient, PreviewContext} from '../server'

export type NextPreviewBarOptions = {
  /** From `createPreviewBar` (`sanity-preview-bar/server`). */
  bar: PreviewBar
  /** A server Sanity client with a read token (e.g. `client.withConfig({token})`). */
  client: PreviewClient
}

type RouteContext = {params: Promise<Record<string, string | string[] | undefined>>}

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

/** `next-sanity` and Next's draft mode use these attributes: `None; Secure` off localhost. */
function cookieOptions(secure: boolean) {
  return {httpOnly: true, path: '/', sameSite: secure ? 'none' : 'lax', secure} as const
}

export function createNextPreviewBar(options: NextPreviewBarOptions) {
  const {bar, client} = options
  const basePath = bar.options.basePath

  async function context(request: Request): Promise<PreviewContext> {
    const jar = await cookies()
    return {
      request,
      previewEnabled: (await draftMode()).isEnabled,
      client,
      perspective: parsePerspective(jar.get(PERSPECTIVE_COOKIE)?.value),
    }
  }

  /** A stand-in request for server components, which have headers but no `Request`. */
  async function currentRequest() {
    const list = await headers()
    const host = list.get('x-forwarded-host') ?? list.get('host') ?? 'localhost'
    const protocol =
      list.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
    return new Request(`${protocol}://${host}${basePath}`, {headers: list})
  }

  async function handle(request: Request, {params}: RouteContext) {
    const action = param((await params).action)
    if (request.method === 'GET' && action === 'search') return bar.search(await context(request))
    if (request.method === 'POST') {
      switch (action) {
        case 'perspective':
          return bar.perspective(await context(request))
        case 'share':
          return bar.share(await context(request))
        case 'exit':
          // Draft mode's own cookie goes through Next, which merges it into the response.
          return bar.exit({request}, async () => (await draftMode()).disable())
      }
    }
    return new Response('Not found', {status: 404})
  }

  return {
    /** `app/preview-bar/[action]/route.ts`: `export const {GET, POST} = previewBar.handlers`. */
    handlers: {GET: handle, POST: handle},

    /**
     * `app/preview-bar/page.tsx`: the bar's data, or a 404 outside draft mode. Pass it to
     * `<PreviewBarFrame data={…} />`.
     */
    async loadBar(): Promise<PreviewBarData> {
      const data = await bar.loadBar(await context(await currentRequest()))
      if (!data) notFound()
      return data
    },

    /**
     * `app/p/[code]/page.tsx`: redirects a live link to the open handler; calls `notFound()` for
     * an unknown, malformed or expired one (render `<PreviewLinkErrorFrame expired />` in that
     * segment's `not-found.tsx`). Returns `'unavailable'` when the store can't be read, for the
     * page to render `<PreviewLinkErrorFrame expired={false} />`.
     */
    async checkLink(code: string): Promise<'unavailable'> {
      const result = await bar.resolveLink(code)
      if (result.status === 200) redirect(`${basePath}/open/${code}`)
      if (result.status === 404) notFound()
      return 'unavailable'
    },

    /**
     * `app/preview-bar/open/[code]/route.ts`: `export const GET = previewBar.openLink`. Turns
     * draft mode on, sets the stored perspective and redirects to the stored page; a link that
     * has gone meanwhile goes back to `/p/<code>` for the expired page.
     */
    async openLink(request: Request, {params}: RouteContext): Promise<Response> {
      const code = param((await params).code) ?? ''
      const result = await bar.resolveLink(code)
      if (result.status !== 200) redirect(`${bar.options.linkRoute}${code}`)
      ;(await draftMode()).enable()
      const secure = new URL(request.url).protocol === 'https:'
      ;(await cookies()).set(
        PERSPECTIVE_COOKIE,
        serializePerspective(result.link.perspective),
        cookieOptions(secure),
      )
      redirect(result.link.pathname)
    },
  }
}
