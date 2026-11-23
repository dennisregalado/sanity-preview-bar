/**
 * Document base for the pages that render pure Sanity UI (the bar's frame, the expired-link page).
 * No site CSS loads there, so no Tailwind preflight: box model, the Studio's font smoothing and
 * Inter from Sanity's CDN, the faces the standalone Studio document declares
 * (`@sanity/cli-build` DefaultDocument). Injected once per document by the mount functions.
 */
const FONT_BASE = 'https://studio-static.sanity.io'

const BASE_CSS = `
*, *::before, *::after { box-sizing: border-box; }
html, body {
  margin: 0;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
${[
  [400, 'Regular'],
  [500, 'Medium'],
  [600, 'SemiBold'],
]
  .map(
    ([weight, name]) =>
      `@font-face { font-family: Inter; font-style: normal; font-weight: ${weight}; font-display: swap; src: url('${FONT_BASE}/Inter-${name}.woff2') format('woff2'); }`,
  )
  .join('\n')}
`

/**
 * The bar's frame is transparent, full height and never scrolls. `color-scheme: normal` keeps it
 * transparent: browsers paint an iframe's canvas opaque when its color scheme differs from the
 * embedding page's, and the Studio layer's `ui5` styles set `:root { color-scheme: light dark }`
 * (in a CSS layer, so this unlayered rule wins). Clipped, the opaque canvas hides behind the bar;
 * unclipped for a tooltip or menu, it covered the whole site. The bar's dark theme comes from
 * Sanity UI's variables, not from `color-scheme`.
 */
const FRAME_CSS = `
:root { color-scheme: normal; }
html, body { height: 100%; overflow: hidden; background: transparent; }
`

export function injectStudioDocumentCss(
  document: Document,
  {transparent = false}: {transparent?: boolean} = {},
) {
  if (document.getElementById('sanity-preview-bar-document')) return
  const style = document.createElement('style')
  style.id = 'sanity-preview-bar-document'
  style.textContent = transparent ? BASE_CSS + FRAME_CSS : BASE_CSS
  document.head.appendChild(style)
}

function isStylesheet(node: Element) {
  return (
    node.localName === 'style' ||
    (node.localName === 'link' && /\bstylesheet\b/.test((node as HTMLLinkElement).rel))
  )
}

/**
 * Keeps styled-components' `<style>` tags after every other stylesheet in the frame's `<head>`, the
 * order a standalone Studio page has (its CSS is in the HTML; styled-components appends at runtime).
 *
 * Studio components show and hide parts with styled-components rules that tie, on specificity,
 * with Sanity UI's atomic classes (`.eBwYdj [data-ui="Select"] { display: none }` against
 * `.u-…:not([hidden]) { display: inline-block }`), so the later stylesheet wins. Here `sanity` loads
 * lazily and its CSS lands after styled-components' tag, which showed both the field-group tabs and
 * their narrow-width select. Other stylesheets move in front of the styled tags; those tags never
 * move, since moving one would drop the rules styled-components inserts through the CSSOM.
 */
export function keepStyledComponentsLast(document: Document) {
  const head = document.head
  function reorder() {
    const styled = head.querySelector('style[data-styled]')
    if (!styled) return
    let node = styled.nextElementSibling
    while (node) {
      const next = node.nextElementSibling
      if (isStylesheet(node) && !node.hasAttribute('data-styled')) head.insertBefore(node, styled)
      node = next
    }
  }
  const observer = new MutationObserver(reorder)
  observer.observe(head, {childList: true})
  reorder()
  return () => observer.disconnect()
}
