/**
 * Short, expiring preview links (`/p/<code>`), like Shopify's "Share preview". The preview bar asks
 * `/preview-bar/share` for one while Presentation's "Share this preview" is on; opening it sets the
 * preview cookies and redirects to the stored page. A `PreviewLinkStore` (Workers KV,
 * or anything with a TTL) holds `code → { pathname, perspective, createdAt }`, so no secret ever
 * appears in the URL. The store should expire the entry on its own; the server also checks
 * `createdAt` against the TTL, so a store that keeps entries forever doesn't make links permanent.
 */

import {sameOriginPath} from './paths'

/** Links open for 2 days, like Shopify's preview links. */
export const PREVIEW_LINK_TTL_SECONDS = 2 * 24 * 60 * 60

/** Default route prefix for the short links; disallow it in `robots.txt`. */
export const PREVIEW_LINK_ROUTE = '/p/'

/** KV key prefix, so the namespace can hold other kinds of entry later. */
export const PREVIEW_LINK_KEY_PREFIX = 'preview-link:'

/** Base62: URL-safe, no punctuation at the ends of a link. 12 characters ≈ 71 bits. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
export const PREVIEW_LINK_CODE_LENGTH = 12
const CODE_PATTERN = new RegExp(`^[A-Za-z0-9]{${PREVIEW_LINK_CODE_LENGTH}}$`)

/** Longest page path (with query) a link may store. */
const MAX_PATHNAME_LENGTH = 2048

export type PreviewLinkValue = {
  /** Root-relative page path, with any query string. */
  pathname: string
  /** Serialized perspective, the `sanity-preview-perspective` cookie value. */
  perspective: string
  /** ISO timestamp. */
  createdAt: string
}

/**
 * A random code from `crypto.getRandomValues`. Bytes ≥ 248 are dropped (248 = 4 × 62) so every
 * character is equally likely.
 */
export function generatePreviewLinkCode(
  fillRandom: (array: Uint8Array<ArrayBuffer>) => void = (array) => crypto.getRandomValues(array),
) {
  let code = ''
  while (code.length < PREVIEW_LINK_CODE_LENGTH) {
    const bytes = new Uint8Array(PREVIEW_LINK_CODE_LENGTH * 2)
    fillRandom(bytes)
    for (const byte of bytes) {
      if (byte >= 248) continue
      code += ALPHABET[byte % ALPHABET.length]
      if (code.length === PREVIEW_LINK_CODE_LENGTH) break
    }
  }
  return code
}

/** Whether `value` could be a code we minted; anything else 404s without a KV read. */
export function isPreviewLinkCode(value: string) {
  return CODE_PATTERN.test(value)
}

export function previewLinkKey(code: string) {
  return `${PREVIEW_LINK_KEY_PREFIX}${code}`
}

/**
 * A root-relative path on this site, normalized (pathname and query, no hash), or `null`. Rejects
 * protocol-relative `//host` and `/\host` (browsers read a backslash as a slash), absolute URLs,
 * control characters and anything that resolves to another origin or to `//host`, before or after
 * dot segments are removed (`/.//host`, `/%2e%2e//host`). See `sameOriginPath`.
 */
export function normalizePreviewPathname(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PATHNAME_LENGTH) {
    return null
  }
  const path = sameOriginPath(value)
  if (!path) return null
  // Neither a pathname nor a query can hold `#`, so the hash starts at the first one.
  const hash = path.indexOf('#')
  return hash === -1 ? path : path.slice(0, hash)
}

/** The KV entry and put options for a new link, and when it stops opening. */
export function createPreviewLink({
  code,
  pathname,
  perspective,
  now = Date.now(),
  ttlSeconds = PREVIEW_LINK_TTL_SECONDS,
  route = PREVIEW_LINK_ROUTE,
}: {
  code: string
  pathname: string
  perspective: string
  now?: number
  ttlSeconds?: number
  route?: string
}) {
  const value: PreviewLinkValue = {pathname, perspective, createdAt: new Date(now).toISOString()}
  return {
    key: previewLinkKey(code),
    value,
    ttlSeconds,
    path: `${route}${code}`,
    expiresAt: new Date(now + ttlSeconds * 1000).toISOString(),
  }
}

/**
 * When a stored link stops opening (ms since the epoch), from its `createdAt` and the TTL, or
 * `null` when `createdAt` isn't a date.
 */
export function previewLinkExpiry(value: Pick<PreviewLinkValue, 'createdAt'>, ttlSeconds: number) {
  const createdAt = Date.parse(value.createdAt)
  return Number.isFinite(createdAt) ? createdAt + ttlSeconds * 1000 : null
}

/** Reads a stored entry back, or `null` when it isn't one of ours (or its path no longer validates). */
export function parsePreviewLinkValue(raw: unknown): PreviewLinkValue | null {
  if (!raw || typeof raw !== 'object') return null
  const {pathname, perspective, createdAt} = raw as Record<string, unknown>
  const safePathname = normalizePreviewPathname(pathname)
  if (!safePathname || typeof perspective !== 'string' || typeof createdAt !== 'string') {
    return null
  }
  return {pathname: safePathname, perspective, createdAt}
}

/**
 * Where short links live. `get` returns the stored value (parsed JSON) or `null`; `put` stores it
 * for `ttlSeconds` and lets it expire on its own. See `kvStore` and `memoryStore`.
 */
export type PreviewLinkStore = {
  get(key: string): Promise<unknown>
  put(key: string, value: PreviewLinkValue, ttlSeconds: number): Promise<void>
}

/** The slice of a Cloudflare Workers KV namespace the store uses. */
export type KVNamespaceLike = {
  get(key: string, type: 'json'): Promise<unknown>
  put(key: string, value: string, options: {expirationTtl: number}): Promise<void>
}

/** A Cloudflare Workers KV store. KV's minimum TTL is 60 seconds. */
export function kvStore(namespace: KVNamespaceLike | undefined | null): PreviewLinkStore {
  return {
    async get(key) {
      if (!namespace) throw new Error('sanity-preview-bar: the KV namespace binding is missing')
      return namespace.get(key, 'json')
    },
    async put(key, value, ttlSeconds) {
      if (!namespace) throw new Error('sanity-preview-bar: the KV namespace binding is missing')
      await namespace.put(key, JSON.stringify(value), {expirationTtl: ttlSeconds})
    },
  }
}

/** An in-memory store for tests and local experiments; entries vanish on restart. */
export function memoryStore(now: () => number = Date.now): PreviewLinkStore {
  const entries = new Map<string, {value: PreviewLinkValue; expiresAt: number}>()
  return {
    async get(key) {
      const entry = entries.get(key)
      if (!entry) return null
      if (entry.expiresAt <= now()) {
        entries.delete(key)
        return null
      }
      return entry.value
    },
    async put(key, value, ttlSeconds) {
      entries.set(key, {value, expiresAt: now() + ttlSeconds * 1000})
    },
  }
}
