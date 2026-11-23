import {describe, expect, test} from 'vitest'
import {readPreviewBarPosition} from '../src/core/protocol'
import {panelClipPath} from '../src/host'

const H = '(50px + env(safe-area-inset-bottom, 0px))'

describe('panelClipPath', () => {
  test('bottom bar, right pane: the strip along the bottom plus the right column', () => {
    expect(panelClipPath('right', 'bottom', 420, H)).toBe(
      `polygon(0 calc(100% - ${H}), calc(100% - 420px) calc(100% - ${H}), calc(100% - 420px) 0, 100% 0, 100% 100%, 0 100%)`,
    )
  })

  test('bottom bar, left pane', () => {
    expect(panelClipPath('left', 'bottom', 420, H)).toBe(
      `polygon(0 0, 420px 0, 420px calc(100% - ${H}), 100% calc(100% - ${H}), 100% 100%, 0 100%)`,
    )
  })

  test('top bar, right pane', () => {
    expect(panelClipPath('right', 'top', 420, H)).toBe(
      `polygon(0 0, 100% 0, 100% 100%, calc(100% - 420px) 100%, calc(100% - 420px) calc${H}, 0 calc${H})`,
    )
  })

  test('top bar, left pane', () => {
    expect(panelClipPath('left', 'top', 420, H)).toBe(
      `polygon(0 0, 100% 0, 100% calc${H}, 420px calc${H}, 420px 100%, 0 100%)`,
    )
  })
})

describe('readPreviewBarPosition', () => {
  test('top only when the frame URL says so', () => {
    expect(readPreviewBarPosition('?position=top')).toBe('top')
    expect(readPreviewBarPosition('')).toBe('bottom')
    expect(readPreviewBarPosition('?position=left')).toBe('bottom')
  })
})
