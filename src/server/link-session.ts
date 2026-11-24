/**
 * Signed, expiring link-session cookies: what a `/p/<code>` link leaves in the browser instead of
 * the site's preview secret. The value is `<expires>.<signature>`, where `expires` is in seconds
 * since the epoch and the signature is HMAC-SHA-256 over it, keyed with the preview secret. It
 * proves "opened a live share link, valid until `expires`" and nothing else, so copying it gains
 * no more than the link itself gave.
 */

/** The link-session cookie's default name. */
export const LINK_SESSION_COOKIE = '__sanity_preview_link'

const encoder = new TextEncoder()
const LABEL = 'sanity-preview-bar/link-session/v1:'

function key(secret: string) {
  if (!secret) throw new Error('sanity-preview-bar: the preview secret is empty')
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    {name: 'HMAC', hash: 'SHA-256'},
    false,
    ['sign', 'verify'],
  )
}

function toBase64Url(bytes: ArrayBuffer) {
  let binary = ''
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

/** A link-session cookie value valid until `expiresAt` (ms since the epoch). */
export async function signLinkSession(secret: string, expiresAt: number) {
  const expires = String(Math.floor(expiresAt / 1000))
  const signature = await crypto.subtle.sign(
    'HMAC',
    await key(secret),
    encoder.encode(LABEL + expires),
  )
  return `${expires}.${toBase64Url(signature)}`
}

/**
 * When a link-session cookie value expires (ms since the epoch), or `null` when it is malformed,
 * forged or expired. The signature check is `crypto.subtle.verify`'s, which is constant-time.
 */
export async function verifyLinkSession(
  secret: string,
  value: string | undefined | null,
  now = Date.now(),
): Promise<number | null> {
  if (!value || value.length > 128) return null
  const match = /^(\d{1,12})\.([A-Za-z0-9_-]+)$/.exec(value)
  if (!match) return null
  const expiresAt = Number(match[1]) * 1000
  if (!(expiresAt > now)) return null
  const signature = fromBase64Url(match[2])
  if (!signature) return null
  const valid = await crypto.subtle.verify(
    'HMAC',
    await key(secret),
    signature,
    encoder.encode(LABEL + match[1]),
  )
  return valid ? expiresAt : null
}
