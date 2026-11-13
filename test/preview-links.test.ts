import {describe, expect, test} from 'vitest'
import {
  PREVIEW_LINK_CODE_LENGTH,
  PREVIEW_LINK_KEY_PREFIX,
  PREVIEW_LINK_TTL_SECONDS,
  createPreviewLink,
  generatePreviewLinkCode,
  isPreviewLinkCode,
  normalizePreviewPathname,
  parsePreviewLinkValue,
  previewLinkKey,
} from '../src/core/preview-links'

describe('preview link codes', () => {
  test('are at least 10 URL-safe characters', () => {
    expect(PREVIEW_LINK_CODE_LENGTH).toBeGreaterThanOrEqual(10)
    for (let i = 0; i < 200; i++) {
      const code = generatePreviewLinkCode()
      expect(code).toMatch(/^[A-Za-z0-9]+$/)
      expect(code).toHaveLength(PREVIEW_LINK_CODE_LENGTH)
      expect(encodeURIComponent(code)).toBe(code)
      expect(isPreviewLinkCode(code)).toBe(true)
    }
  })

  test('do not repeat', () => {
    const codes = new Set(Array.from({length: 5000}, () => generatePreviewLinkCode()))
    expect(codes.size).toBe(5000)
  })

  test('skip biased bytes and keep drawing until the code is full', () => {
    let calls = 0
    // First draw: all 255 (rejected). Second: 0, 61, 62, 247 → A, 9, A, 9 …
    const code = generatePreviewLinkCode((array) => {
      calls++
      const pattern = calls === 1 ? [255] : [0, 61, 62, 247]
      array.forEach((_, index) => (array[index] = pattern[index % pattern.length]))
    })
    expect(calls).toBe(2)
    expect(code).toBe('A9A9A9A9A9A9')
  })

  test('anything else is not a code', () => {
    for (const value of [
      '',
      'short',
      'A9A9A9A9A9A9A',
      'A9A9A9A9A9A-',
      '../../etc/pass',
      'A9A9A9A9A9 9',
    ]) {
      expect(isPreviewLinkCode(value)).toBe(false)
    }
  })
})

describe('normalizePreviewPathname', () => {
  test('keeps root-relative paths with their query', () => {
    expect(normalizePreviewPathname('/')).toBe('/')
    expect(normalizePreviewPathname('/products/chair')).toBe('/products/chair')
    expect(normalizePreviewPathname('/search?q=sofa&page=2')).toBe('/search?q=sofa&page=2')
    expect(normalizePreviewPathname('/a/../makers')).toBe('/makers')
    expect(normalizePreviewPathname('/pages/trade#faq')).toBe('/pages/trade')
  })

  test('rejects anything that could leave the site', () => {
    for (const value of [
      '//evil.example',
      '//evil.example/path',
      '/\\evil.example',
      '\\\\evil.example',
      'https://evil.example/',
      'javascript:alert(1)',
      'products',
      '',
      '/\nevil',
      '/\tevil',
      `/${'a'.repeat(2048)}`,
      null,
      undefined,
      42,
      ['/'],
    ]) {
      expect(normalizePreviewPathname(value)).toBeNull()
    }
  })
})

describe('createPreviewLink', () => {
  const now = Date.UTC(2026, 10, 13, 12, 0, 0)
  const link = createPreviewLink({
    code: 'AbCdEf123456',
    pathname: '/makers',
    perspective: 'rSummer,drafts',
    now,
  })

  test('stores only the page, perspective and creation time under a prefixed key', () => {
    expect(link.key).toBe(`${PREVIEW_LINK_KEY_PREFIX}AbCdEf123456`)
    expect(link.key).toBe(previewLinkKey('AbCdEf123456'))
    expect(link.value).toEqual({
      pathname: '/makers',
      perspective: 'rSummer,drafts',
      createdAt: '2026-11-13T12:00:00.000Z',
    })
    expect(Object.keys(link.value).sort()).toEqual(['createdAt', 'pathname', 'perspective'])
  })

  test('expires after 2 days', () => {
    expect(PREVIEW_LINK_TTL_SECONDS).toBe(172_800)
    expect(link.ttlSeconds).toBe(PREVIEW_LINK_TTL_SECONDS)
    expect(link.expiresAt).toBe('2026-11-15T12:00:00.000Z')
    expect(link.path).toBe('/p/AbCdEf123456')
  })

  test('round-trips through JSON and rejects foreign values', () => {
    expect(parsePreviewLinkValue(JSON.parse(JSON.stringify(link.value)))).toEqual(link.value)
    expect(parsePreviewLinkValue(null)).toBeNull()
    expect(parsePreviewLinkValue('/makers')).toBeNull()
    expect(parsePreviewLinkValue({...link.value, pathname: '//evil.example'})).toBeNull()
    expect(parsePreviewLinkValue({...link.value, perspective: 3})).toBeNull()
    expect(parsePreviewLinkValue({pathname: '/makers', perspective: 'drafts'})).toBeNull()
  })
})
