import {describe, expect, test} from 'vitest'
import {PANEL_MIN_WIDTH, PANEL_WIDTH, panelLayout, publishedId} from '../src/bar/pane-state'

describe('panelLayout', () => {
  test('keeps the preferred width beside a wide page', () => {
    expect(panelLayout(PANEL_WIDTH, 1440)).toEqual({width: 420, beside: true})
    expect(panelLayout(600, 1440)).toEqual({width: 600, beside: true})
  })

  test('clamps to the minimum width and to 360px of page', () => {
    expect(panelLayout(100, 1440)).toEqual({width: PANEL_MIN_WIDTH, beside: true})
    expect(panelLayout(2000, 1440)).toEqual({width: 1080, beside: true})
    expect(panelLayout(420, 810)).toEqual({width: 420, beside: true})
    expect(panelLayout(600, 810)).toEqual({width: 450, beside: true})
  })

  test('overlays the page when even the narrowest pane leaves less than 360px', () => {
    expect(panelLayout(420, 600)).toEqual({width: 420, beside: false})
    expect(panelLayout(420, 375)).toEqual({width: 375, beside: false})
  })
})

describe('publishedId', () => {
  test('strips draft and release version prefixes', () => {
    expect(publishedId('drafts.page-home')).toBe('page-home')
    expect(publishedId('versions.rABC123.page-home')).toBe('page-home')
    expect(publishedId('page-home')).toBe('page-home')
  })
})
