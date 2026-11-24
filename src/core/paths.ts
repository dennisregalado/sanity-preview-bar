/**
 * Same-origin path checks, shared by everything that turns an untrusted string into a page on this
 * site: short links, `postMessage` paths and the Visual Editor's `?preview=` parameter.
 */

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/
const BASE = 'https://same-origin.invalid'

/**
 * `value` as a root-relative path on this site (pathname, query and hash, normalized), or `null`.
 *
 * Checks the input and the result: browsers read `\` as `/` and drop tabs and newlines, and
 * resolving dot segments can turn `/.//host` or `/%2e%2e//host` into `//host`, which is another
 * site once it lands in a `Location` header or `new URL(path, origin)`. A path whose first segment
 * starts with an encoded slash or backslash (`/%2f…`, `/%5c…`) is refused too, since a server that
 * decodes it before redirecting would do the same.
 */
export function sameOriginPath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/')) return null
  if (value.startsWith('//') || value.includes('\\') || CONTROL_CHARACTERS.test(value)) return null
  let url: URL
  try {
    url = new URL(value, BASE)
  } catch {
    return null
  }
  if (url.origin !== BASE) return null
  const {pathname} = url
  if (
    !pathname.startsWith('/') ||
    pathname.startsWith('//') ||
    pathname.includes('\\') ||
    /^\/%(2f|5c)/i.test(pathname)
  ) {
    return null
  }
  return `${pathname}${url.search}${url.hash}`
}

/** Whether `value` is a root-relative path that stays on this site; see `sameOriginPath`. */
export function isSameOriginPath(value: unknown): value is string {
  return sameOriginPath(value) !== null
}
