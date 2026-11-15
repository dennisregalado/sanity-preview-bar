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
