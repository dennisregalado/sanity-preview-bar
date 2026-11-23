/**
 * SvelteKit adapter, for sites using `@sanity/sveltekit`'s `handlePreviewMode` (the
 * `__sanity_preview` cookie and `event.locals.sanity`). Each route file re-exports one handler; see
 * the README for the full set.
 */
import {error, redirect, type RequestEvent} from '@sveltejs/kit'

import type {PreviewBarData} from '../core/data'
import {
  parsePerspective,
  PERSPECTIVE_COOKIE,
  type PreviewPerspective,
  serializePerspective,
} from '../core/perspective'
import {isPresentationRequest} from '../core/presentation'
import type {PreviewBar, PreviewClient, PreviewContext, PreviewModeSwitch} from '../server'
import {deleteCookieHeader} from '../server'

/** `handlePreviewMode`'s default preview cookie. */
export const SANITY_PREVIEW_COOKIE = '__sanity_preview'

/** What `@sanity/sveltekit` puts on `event.locals.sanity`. */
type SanityLocals = {
  previewEnabled: boolean
  client: PreviewClient
  previewPerspective?: unknown
}

function sanityLocals(event: RequestEvent): SanityLocals {
  const sanity = (event.locals as {sanity?: SanityLocals}).sanity
  if (!sanity) {
    throw new Error(
      'sanity-preview-bar: event.locals.sanity is missing; add @sanity/sveltekit handlePreviewMode to hooks.server.ts',
    )
  }
  return sanity
}

export type SvelteKitPreviewBarOptions = {
  /** From `createPreviewBar` (`sanity-preview-bar/server`). */
  bar: PreviewBar
  /** The `handlePreviewMode` secret, which is the `__sanity_preview` cookie's value. */
  previewSecret: string | (() => string)
  /** Default `__sanity_preview`. */
  previewCookie?: string
}

export function createSvelteKitPreviewBar(options: SvelteKitPreviewBarOptions) {
  const {bar} = options
  const previewCookie = options.previewCookie ?? SANITY_PREVIEW_COOKIE
  const secret = () =>
    typeof options.previewSecret === 'function' ? options.previewSecret() : options.previewSecret

  function context(event: RequestEvent): PreviewContext {
    const sanity = sanityLocals(event)
    return {
      request: event.request,
      previewEnabled: sanity.previewEnabled,
      client: sanity.client,
      perspective: parsePerspective(event.cookies.get(PERSPECTIVE_COOKIE)),
    }
  }

  const disablePreview: PreviewModeSwitch = (headers, request) => {
    headers.append('set-cookie', deleteCookieHeader(request, previewCookie))
  }

  function cookieAttributes(event: RequestEvent) {
    const secure = event.url.protocol === 'https:'
    return {
      httpOnly: true,
      path: '/',
      sameSite: secure ? 'none' : 'lax',
      secure,
    } as const
  }

  return {
    /** `/preview-bar/+page.server.ts`: `export const load = previewBar.loadBar`. */
    async loadBar(event: RequestEvent): Promise<PreviewBarData> {
      event.setHeaders({'cache-control': 'private, no-store', 'x-robots-tag': 'noindex'})
      const data = await bar.loadBar(context(event))
      if (!data) error(404, 'Not found')
      return data
    },
    /** `/preview-bar/perspective/+server.ts`: `export const POST = previewBar.perspective`. */
    perspective: (event: RequestEvent) => bar.perspective(context(event)),
    /** `/preview-bar/exit/+server.ts`: `export const POST = previewBar.exit`. */
    exit: (event: RequestEvent) => bar.exit({request: event.request}, disablePreview),
    /** `/preview-bar/search/+server.ts`: `export const GET = previewBar.search`. */
    search: (event: RequestEvent) => bar.search(context(event)),
    /** `/preview-bar/resolve/+server.ts`: `export const GET = previewBar.resolveHref`. */
    resolveHref: (event: RequestEvent) => bar.resolveHref(context(event)),
    /** `/preview-bar/data/+server.ts`: `export const GET = previewBar.data` (the Visual Editor). */
    data: (event: RequestEvent) => bar.barData(context(event)),
    /** `/preview-bar/document/+server.ts`: `export const GET = previewBar.pageDocument`. */
    pageDocument: (event: RequestEvent) => bar.pageDocument(context(event)),
    /** `/preview-bar/share/+server.ts`: `export const POST = previewBar.share`. */
    share: (event: RequestEvent) => bar.share(context(event)),
    /**
     * `/p/[code]/+page.server.ts`: `export const load = previewBar.openLink`. Redirects into
     * preview, or throws 404/503 for `+error.svelte` to render the expired-link page.
     */
    async openLink(event: RequestEvent & {params: {code?: string}}): Promise<never> {
      event.setHeaders({'cache-control': 'private, no-store', 'x-robots-tag': 'noindex'})
      const result = await bar.resolveLink(event.params.code ?? '')
      if (result.status !== 200) {
        error(
          result.status,
          result.status === 404 ? 'Preview link not found' : 'Preview links are not configured',
        )
      }
      const attributes = cookieAttributes(event)
      event.cookies.set(previewCookie, secret(), attributes)
      event.cookies.set(
        PERSPECTIVE_COOKIE,
        serializePerspective(result.link.perspective),
        attributes,
      )
      redirect(307, result.link.pathname)
    },
  }
}

/**
 * Applies the perspective cookie to `event.locals.sanity.client` in preview, and keeps stega (and
 * so Visual Editing's overlays) to requests from inside the Studio's Presentation tool. Add it to
 * `sequence(...)` after `handlePreviewMode`. Typed structurally rather than as Kit's `Handle`,
 * which moved to `@sveltejs/kit/hooks` in Kit 3, so it fits both majors.
 */
export const handlePreviewPerspective = ({
  event,
  resolve,
}: {
  event: RequestEvent
  resolve: (event: RequestEvent) => Response | Promise<Response>
}) => {
  const sanity = (event.locals as {sanity?: SanityLocals}).sanity
  if (sanity?.previewEnabled) {
    const perspective: PreviewPerspective = parsePerspective(event.cookies.get(PERSPECTIVE_COOKIE))
    sanity.previewPerspective = perspective
    const stega = isPresentationRequest(event.request)
    if (perspective !== 'drafts' || !stega) {
      sanity.client = sanity.client.withConfig({perspective, ...(stega ? {} : {stega: false})})
    }
  }
  return resolve(event)
}
