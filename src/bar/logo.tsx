/**
 * The project's mark, 22×23 like the Studio's `MainIcon`: inline SVG markup (trusted, from the
 * server's options) drawn in the text colour, or an image URL.
 */
export function Logo({logo}: {logo: string}) {
  if (logo.trimStart().startsWith('<svg')) {
    return (
      <span
        aria-hidden="true"
        className="preview-bar-logo"
        style={{display: 'flex', width: 22, height: 23, color: 'var(--card-fg-color)'}}
        dangerouslySetInnerHTML={{__html: logo}}
      />
    )
  }
  return (
    <img
      src={logo}
      alt=""
      width={22}
      height={23}
      style={{display: 'block', objectFit: 'contain'}}
    />
  )
}
