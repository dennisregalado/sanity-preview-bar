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

  test('accepts the panel message with a non-negative width only', () => {
    expect(
      isPreviewBarMessage({type: 'sanity-preview-bar:panel', open: true, width: 420, side: 'left'}),
    ).toBe(true)
    expect(
      isPreviewBarMessage({type: 'sanity-preview-bar:panel', open: false, width: 0, side: 'right'}),
    ).toBe(true)
    for (const data of [
      {type: 'sanity-preview-bar:panel', open: true},
      {type: 'sanity-preview-bar:panel', open: true, width: 420},
      {type: 'sanity-preview-bar:panel', open: true, width: 420, side: 'top'},
      {type: 'sanity-preview-bar:panel', open: 'yes', width: 420, side: 'left'},
      {type: 'sanity-preview-bar:panel', open: true, width: -1, side: 'left'},
      {type: 'sanity-preview-bar:panel', open: true, width: Number.NaN, side: 'left'},
      {type: 'sanity-preview-bar:panel', open: true, width: '420', side: 'left'},
    ]) {
      expect(isPreviewBarMessage(data)).toBe(false)
    }
  })
})
