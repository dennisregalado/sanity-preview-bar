import {describe, expect, test} from 'vitest'
import {
  isPreviewBarMessage,
  PREVIEW_BAR_FRAME_NAME,
  readPreviewBarContext,
} from '../src/core/protocol'

describe('Visual Editor messages', () => {
  test('open-document needs an id and type; template fields are optional', () => {
    const open = (document: unknown) =>
      isPreviewBarMessage({type: 'sanity-preview-bar:open-document', document})
    expect(open({id: 'page-home', type: 'page'})).toBe(true)
    expect(
      open({id: 'abc', type: 'pressArticle', template: 'pressArticle', templateParameters: {}}),
    ).toBe(true)
    expect(open({id: '', type: 'page'})).toBe(false)
    expect(open({id: 'page-home'})).toBe(false)
    expect(open({id: 'a', type: 'page', template: 3})).toBe(false)
    expect(open('page-home')).toBe(false)
  })

  test('perspective selections carry a layer and string exclusions', () => {
    for (const type of ['sanity-preview-bar:perspective', 'sanity-preview-bar:set-perspective']) {
      expect(isPreviewBarMessage({type, selection: {selected: 'drafts', excluded: []}})).toBe(true)
      expect(isPreviewBarMessage({type, selection: {selected: 'rABC', excluded: ['rDEF']}})).toBe(
        true,
      )
      expect(isPreviewBarMessage({type, selection: {selected: 'drafts', excluded: [1]}})).toBe(
        false,
      )
      expect(isPreviewBarMessage({type, selection: {excluded: []}})).toBe(false)
    }
  })

  test('viewport, editor state and frame paths', () => {
    expect(isPreviewBarMessage({type: 'sanity-preview-bar:viewport', mode: 'mobile'})).toBe(true)
    expect(isPreviewBarMessage({type: 'sanity-preview-bar:viewport', mode: 'tablet'})).toBe(true)
    expect(isPreviewBarMessage({type: 'sanity-preview-bar:viewport', mode: 'watch'})).toBe(false)
    expect(isPreviewBarMessage({type: 'sanity-preview-bar:editor-state', open: true})).toBe(true)
    expect(isPreviewBarMessage({type: 'sanity-preview-bar:editor-state', open: 'yes'})).toBe(false)
    expect(isPreviewBarMessage({type: 'sanity-preview-bar:frame-path', path: '/makers'})).toBe(true)
    expect(
      isPreviewBarMessage({type: 'sanity-preview-bar:frame-path', path: 'https://evil.test/'}),
    ).toBe(false)
  })

  test('the bar reads its context from the frame URL', () => {
    expect(readPreviewBarContext('?context=tool&position=top')).toBe('tool')
    expect(readPreviewBarContext('')).toBe('site')
    expect(PREVIEW_BAR_FRAME_NAME).toBe('sanity-preview-bar-frame')
  })
})
