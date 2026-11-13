/**
 * The project's mark, as the Studio draws a workspace icon (`WorkspacePreviewIcon`): inline SVG
 * markup (trusted, from the server's options) in the text colour, or an image URL.
 *
 * - `small`, the navbar's `HomeButton`: a 25×25 `LogoMarkContainer` (`Card radius={2}`, 3px, with
 *   `overflow: hidden`). An SVG mark is 22×23 like `MainIcon`; an image fills the tile.
 * - `large`, the workspace menu: a 41×41 `Media` box (`border-radius: 0.25rem`). The mark keeps its
 *   own size, as Studio icons that fix it do (an SVG `MainIcon` at 22×23 with `margin: auto`,
 *   centred; an `<img>` at 25px in the top-left corner).
 */
export function Logo({logo, size = 'small'}: {logo: string; size?: 'small' | 'large'}) {
  const svg = logo.trimStart().startsWith('<svg')
  if (size === 'large') {
    return (
      <span
        aria-hidden="true"
        style={{display: 'block', flex: 'none', width: 41, height: 41, borderRadius: 4}}
      >
        {svg ? (
          <span style={{display: 'flex', width: 41, height: 41}}>
            <span
              className="preview-bar-logo"
              style={{
                display: 'flex',
                width: 22,
                height: 23,
                margin: 'auto',
                color: 'var(--card-fg-color)',
              }}
              dangerouslySetInnerHTML={{__html: logo}}
            />
          </span>
        ) : (
          <img src={logo} alt="" width={25} height={25} style={{display: 'block'}} />
        )}
      </span>
    )
  }
  if (svg) {
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
      width={25}
      height={25}
      style={{display: 'block', width: 25, height: 25, borderRadius: 3, objectFit: 'cover'}}
    />
  )
}
