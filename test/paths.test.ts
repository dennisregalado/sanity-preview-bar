import {describe, expect, test} from 'vitest'

import {isSameOriginPath, sameOriginPath} from '../src/core/paths'
import {isPreviewBarMessage} from '../src/core/protocol'
import {normalizePreviewPathname} from '../src/core/preview-links'

const ORIGIN = 'https://shop.example'

/** Paths that reach another site once resolved, put in a `Location` header or framed. */
const OFF_SITE = [
  '/.//evil.example',
  '/.//evil.example/x',
  '/%2e%2e//evil.example',
  '/%2E%2E//evil.example',
  '/a/..//evil.example',
  '/a/%2e%2e//evil.example',
  '/\\evil.example',
  '/\\evil.example/x',
  '/%5Cevil.example',
  '/%5cevil.example',
  '/%2Fevil.example',
  '/\t/evil.example',
  '/\n/evil.example',
  '/\r/evil.example',
  '/\u0000evil',
  '/\u007fevil',
  '//evil.example',
  'https://evil.example/',
  'javascript:alert(1)',
  'evil.example',
  '',
  null,
  undefined,
  42,
]

describe('sameOriginPath', () => {
  test('keeps same-origin paths, normalized', () => {
    expect(sameOriginPath('/')).toBe('/')
    expect(sameOriginPath('/products/chair?x=1#top')).toBe('/products/chair?x=1#top')
    expect(sameOriginPath('/a/../makers')).toBe('/makers')
    expect(sameOriginPath('/./x')).toBe('/x')
    expect(sameOriginPath('/search?q=%5C')).toBe('/search?q=%5C')
    expect(sameOriginPath('/a/%5Cb')).toBe('/a/%5Cb')
  })

  test.each(OFF_SITE.map((value) => [JSON.stringify(value), value]))(
    'rejects %s',
    (_label, value) => {
      expect(sameOriginPath(value)).toBeNull()
      expect(isSameOriginPath(value)).toBe(false)
    },
  )

  test('anything it accepts resolves to the same origin', () => {
    for (const value of ['/', '/a/../b', '/%2e/x', '/a//b', '/x?next=//evil.example']) {
      const path = sameOriginPath(value)
      expect(path).not.toBeNull()
      expect(new URL(path!, ORIGIN).origin).toBe(ORIGIN)
      expect(new URL(value, ORIGIN).origin).toBe(ORIGIN)
    }
  })
})

describe('the shared check guards every path input', () => {
  test.each(OFF_SITE.map((value) => [JSON.stringify(value), value]))(
    'normalizePreviewPathname and protocol messages reject %s',
    (_label, value) => {
      expect(normalizePreviewPathname(value)).toBeNull()
      for (const type of ['sanity-preview-bar:path', 'sanity-preview-bar:frame-path']) {
        expect(isPreviewBarMessage({type, path: value})).toBe(false)
      }
      expect(isPreviewBarMessage({type: 'sanity-preview-bar:navigate', href: value})).toBe(false)
    },
  )

  test('protocol messages still take ordinary paths', () => {
    expect(isPreviewBarMessage({type: 'sanity-preview-bar:navigate', href: '/products/a'})).toBe(
      true,
    )
    expect(isPreviewBarMessage({type: 'sanity-preview-bar:frame-path', path: '/?q=1'})).toBe(true)
  })
})
