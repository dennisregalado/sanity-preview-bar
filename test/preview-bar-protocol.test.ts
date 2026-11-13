import {describe, expect, test} from 'vitest'
import {isPreviewBarMessage} from '../src/core/protocol'

describe('isPreviewBarMessage', () => {
  test('accepts the three bar messages', () => {
    expect(isPreviewBarMessage({type: 'sanity-preview-bar:ready'})).toBe(true)
    expect(isPreviewBarMessage({type: 'sanity-preview-bar:hide'})).toBe(true)
    expect(isPreviewBarMessage({type: 'sanity-preview-bar:path', path: '/products/a?b=1'})).toBe(
      true,
    )
  })

  test('rejects other shapes, including the legacy bare string', () => {
    for (const data of [
      'hide-preview-bar',
      null,
      undefined,
      42,
      {},
      {type: 'hide-preview-bar'},
      {type: 'sanity-preview-bar:path'},
      {type: 'sanity-preview-bar:path', path: 7},
    ]) {
      expect(isPreviewBarMessage(data)).toBe(false)
    }
  })

  test('rejects a path that is not same-site absolute', () => {
    expect(isPreviewBarMessage({type: 'sanity-preview-bar:path', path: 'https://evil.test/'})).toBe(
      false,
    )
    expect(isPreviewBarMessage({type: 'sanity-preview-bar:path', path: 'products/a'})).toBe(false)
    expect(isPreviewBarMessage({type: 'sanity-preview-bar:path', path: '//evil.test/'})).toBe(false)
  })
})
