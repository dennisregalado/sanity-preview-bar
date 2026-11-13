/**
 * Stega (and Visual Editing's click-to-edit overlays) only inside the Studio's Presentation tool.
 * Stega bloats every string and slows rendering, so a normal preview tab, such as one with the preview
 * bar, gets clean strings. The server can't see the iframe on client-side data requests, so the page
 * inside Presentation marks its own same-origin fetches with `PRESENTATION_HEADER`.
 */
export const PRESENTATION_HEADER = 'x-sanity-presentation'

/**
 * True for requests made by the storefront inside Presentation: the iframe's document loads
 * (`Sec-Fetch-Dest: iframe`) and the client-side fetches it marks. Only consulted in preview mode,
 * so a forged header can't add stega for anyone without the preview cookie.
 */
export function isPresentationRequest(request: Request) {
  return (
    request.headers.get('sec-fetch-dest') === 'iframe' ||
    request.headers.get(PRESENTATION_HEADER) === '1'
  )
}

let marked = false

/**
 * Adds `PRESENTATION_HEADER` to this page's same-origin fetches: remote queries and page data during
 * client-side navigation. Kit looks up `window.fetch` when it fetches, and supports a patched one.
 * Called only in preview inside an iframe.
 */
export function markPresentationFetches() {
  if (marked) return
  marked = true
  const original = window.fetch
  window.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.href)
    if (url.origin !== window.location.origin) return original(input, init)
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    )
    headers.set(PRESENTATION_HEADER, '1')
    return original(input, {...init, headers})
  }
}
