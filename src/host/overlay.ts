/**
 * Click-to-edit: hovering an element marked with `data-sanity` outlines it and labels its field;
 * clicking it asks for that document and path in the Studio's document pane instead of following
 * a link. Framework-agnostic and dependency-free; `mountPreviewBarHost` (while the pane is open)
 * and `mountPreviewBarFrame` (always) run it.
 *
 * Unlike `@sanity/visual-editing`, nothing is registered up front: one passive `pointermove`
 * listener, coalesced to an animation frame, hit-tests at the pointer with
 * `target.closest('[data-sanity]')`. No MutationObserver, IntersectionObserver, ResizeObserver or
 * per-element listeners, so the page can re-render as often as it likes. Boxes are positioned in
 * viewport coordinates (`getBoundingClientRect` in a `position: fixed` layer), so they stay on
 * sticky and fixed content, and a frame loop runs only while a box shows and something moved
 * (pointer, scroll, resize), until the box has settled.
 *
 * Keys: ⌘\ / Ctrl+\ turns it off and on (remembered for the tab); holding Alt/Option hides the
 * outline and lets clicks through to the page; Esc clears the outline until the pointer moves.
 */
import {
  describeSanityPath,
  parseSanityNode,
  SANITY_NODE_ATTRIBUTE,
  type SanityNode,
} from '../core/sanity-node'

export type ClickToEditOptions = {
  /** An editable element was clicked. */
  onEdit: (node: SanityNode) => void
  /**
   * Whether click-to-edit applies right now (the site: while the document pane is open). Default
   * `true`. ⌘\ / Ctrl+\ turns it off on top of this; see `setActive`.
   */
  active?: boolean
  /** The outline layer's z-index. Default just below the bar's frame. */
  zIndex?: number
}

export type ClickToEdit = {
  /** Turn click-to-edit on or off for the context (the pane opened or closed). */
  setActive(active: boolean): void
  destroy(): void
}

export type SanityTarget = {element: Element; node: SanityNode}

const SELECTOR = `[${SANITY_NODE_ATTRIBUTE}]`
/** One below the bar's wrapper (`2147483000`). */
const OVERLAY_Z_INDEX = 2147482999
const OVERLAY_TAG = 'sanity-preview-bar-overlay'
/** `'0'` while the editor has turned click-to-edit off with ⌘\ for this tab. */
const ENABLED_KEY = 'sanity-preview-bar:click-to-edit'
/** Frames the box must hold still before the loop stops (smooth scrolling, transitions). */
const SETTLE_FRAMES = 20
/** Ancestors shown in the label's breadcrumb. */
const MAX_CRUMBS = 3
const TOAST_MS = 1400

/** The nearest element at or above `start` whose `data-sanity` parses. */
export function findSanityTarget(start: EventTarget | Node | null): SanityTarget | null {
  let element: Element | null = null
  if (start instanceof Element) element = start.closest(SELECTOR)
  else if (start instanceof Node) element = start.parentElement?.closest(SELECTOR) ?? null
  while (element) {
    const node = parseSanityNode(element.getAttribute(SANITY_NODE_ATTRIBUTE))
    if (node) return {element, node}
    element = element.parentElement?.closest(SELECTOR) ?? null
  }
  return null
}

/** Labels of the editable ancestors above `element`, outermost first. */
function breadcrumb(element: Element) {
  const crumbs: string[] = []
  let current = element.parentElement?.closest(SELECTOR) ?? null
  while (current && crumbs.length < MAX_CRUMBS) {
    const node = parseSanityNode(current.getAttribute(SANITY_NODE_ATTRIBUTE))
    if (node) crumbs.unshift(describeSanityPath(node.path))
    current = current.parentElement?.closest(SELECTOR) ?? null
  }
  return crumbs
}

function readEnabled() {
  try {
    return window.sessionStorage.getItem(ENABLED_KEY) !== '0'
  } catch {
    return true
  }
}

function storeEnabled(enabled: boolean) {
  try {
    if (enabled) window.sessionStorage.removeItem(ENABLED_KEY)
    else window.sessionStorage.setItem(ENABLED_KEY, '0')
  } catch {
    // Storage blocked: the toggle lasts until the page reloads.
  }
}

function isMac() {
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
}

const STYLE = `
:host {
  all: initial;
  position: fixed;
  inset: 0;
  pointer-events: none;
  contain: strict;
  --accent: #2276fc;
  font: 500 11px/16px -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif;
}
.box {
  position: absolute;
  top: 0;
  left: 0;
  display: none;
  box-sizing: border-box;
  border: 1px solid var(--accent);
  border-radius: 2px;
  background: rgb(34 118 252 / 0.06);
}
.tab {
  position: absolute;
  top: 0;
  left: 0;
  display: none;
  align-items: baseline;
  gap: 6px;
  box-sizing: border-box;
  max-width: min(480px, calc(100vw - 8px));
  padding: 2px 6px;
  border-radius: 3px;
  background: var(--accent);
  color: #fff;
  white-space: nowrap;
}
.crumbs {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0.72;
}
.crumbs:empty { display: none; }
.label { flex: none; font-weight: 600; }
.type { flex: none; opacity: 0.72; }
.toast {
  position: absolute;
  left: 50%;
  bottom: 66px;
  transform: translateX(-50%);
  padding: 6px 10px;
  border-radius: 4px;
  background: rgb(19 20 27 / 0.92);
  color: #fff;
  font-size: 12px;
  opacity: 0;
  transition: opacity 150ms ease-out;
  white-space: nowrap;
}
.toast[data-show] { opacity: 1; }
@media (prefers-reduced-motion: reduce) { .toast { transition: none; } }
`

export function mountClickToEdit(options: ClickToEditOptions): ClickToEdit {
  let available = options.active ?? true
  let enabled = readEnabled()
  let destroyed = false

  /** The pointer's last position in the viewport, and what it was over. */
  let pointer: {x: number; y: number} | null = null
  let pointerTarget: EventTarget | null = null
  let needsResolve = false
  let altHeld = false
  /** Esc cleared the outline; it comes back when the pointer moves. */
  let dismissed = false

  let hovered: SanityTarget | null = null
  /** The hovered element's attribute when its label was drawn. */
  let labelFor: string | null = null
  let lastRect = ''
  let stableFrames = 0
  let frame = 0
  let tabWidth = 0
  let tabHeight = 0

  /** A press intercepted on `pointerdown`, posted on its `click`. */
  let pressed: SanityNode | null = null

  // The layer: one element with an open shadow root, so the page's styles can't reach it.
  const layer = document.createElement(OVERLAY_TAG)
  layer.setAttribute('aria-hidden', 'true')
  layer.style.zIndex = String(options.zIndex ?? OVERLAY_Z_INDEX)
  const shadow = layer.attachShadow({mode: 'open'})
  const style = document.createElement('style')
  style.textContent = STYLE
  const box = document.createElement('div')
  box.className = 'box'
  const tab = document.createElement('div')
  tab.className = 'tab'
  const crumbs = document.createElement('span')
  crumbs.className = 'crumbs'
  const label = document.createElement('span')
  label.className = 'label'
  const type = document.createElement('span')
  type.className = 'type'
  tab.append(crumbs, label, type)
  const toast = document.createElement('div')
  toast.className = 'toast'
  shadow.append(style, box, tab, toast)
  document.body.appendChild(layer)

  const isActive = () => available && enabled && !destroyed

  function schedule() {
    stableFrames = 0
    if (!frame && !destroyed) frame = requestAnimationFrame(tick)
  }

  function hide() {
    box.style.display = 'none'
    tab.style.display = 'none'
    lastRect = ''
  }

  function clear() {
    hovered = null
    labelFor = null
    hide()
  }

  /** Hit-test again where the pointer is, on the next frame (a toggle, Alt released, a scroll). */
  function resolveAtPointer() {
    pointerTarget = null
    needsResolve = true
  }

  function elementAtPointer() {
    return pointer ? document.elementFromPoint(pointer.x, pointer.y) : null
  }

  function drawLabel(target: SanityTarget) {
    crumbs.textContent = breadcrumb(target.element).join(' › ')
    label.textContent = describeSanityPath(target.node.path)
    type.textContent = target.node.type
    tab.style.display = 'flex'
    tabWidth = tab.offsetWidth
    tabHeight = tab.offsetHeight
  }

  function tick() {
    frame = 0
    if (!isActive() || altHeld || dismissed) {
      clear()
      return
    }
    if (needsResolve) {
      needsResolve = false
      hovered = findSanityTarget(pointerTarget ?? elementAtPointer())
      pointerTarget = null
    }
    // A live re-render replaced the hovered element: find what's under the pointer now.
    if (hovered && !hovered.element.isConnected) hovered = findSanityTarget(elementAtPointer())
    if (!hovered) {
      clear()
      return
    }
    // The same element can be re-rendered with another document or path.
    const attribute = hovered.element.getAttribute(SANITY_NODE_ATTRIBUTE)
    if (attribute !== labelFor) {
      const node = parseSanityNode(attribute)
      if (!node) {
        clear()
        if (pointer) {
          resolveAtPointer()
          schedule()
        }
        return
      }
      hovered = {element: hovered.element, node}
      labelFor = attribute
      lastRect = ''
      drawLabel(hovered)
    }

    const rect = hovered.element.getBoundingClientRect()
    const key = `${rect.left},${rect.top},${rect.width},${rect.height}`
    if (key !== lastRect) {
      lastRect = key
      stableFrames = 0
      if (rect.width === 0 && rect.height === 0) {
        box.style.display = 'none'
        tab.style.display = 'none'
      } else {
        place(rect)
      }
    } else {
      stableFrames++
    }
    if (stableFrames < SETTLE_FRAMES) frame = requestAnimationFrame(tick)
  }

  function place(rect: DOMRect) {
    Object.assign(box.style, {
      display: 'block',
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      transform: `translate(${rect.left}px, ${rect.top}px)`,
    })
    // The tab sits on the box's top edge, outside it; inside the top when there's no room above
    // (the viewport's edge or a box taller than the screen), and below a short box at the top.
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth
    const left = Math.max(4, Math.min(rect.left, viewportWidth - tabWidth - 4))
    let top = rect.top - tabHeight
    if (top < 0) top = rect.height > tabHeight * 2 ? Math.max(rect.top, 0) : rect.bottom
    tab.style.display = 'flex'
    tab.style.transform = `translate(${left}px, ${top}px)`
  }

  let toastTimer: ReturnType<typeof setTimeout> | undefined
  function showToast(text: string) {
    toast.textContent = text
    toast.setAttribute('data-show', '')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => toast.removeAttribute('data-show'), TOAST_MS)
  }

  function onPointerMove(event: PointerEvent) {
    pointer = {x: event.clientX, y: event.clientY}
    altHeld = event.altKey
    if (!isActive()) return
    pointerTarget = event.target
    needsResolve = true
    dismissed = false
    schedule()
  }

  // Leaving the window, or moving into a frame (the bar, the pane, an embed) whose events this
  // page doesn't get.
  function onPointerOut(event: PointerEvent) {
    const next = event.relatedTarget
    if (next && !(next instanceof HTMLIFrameElement)) return
    pointer = null
    pointerTarget = null
    needsResolve = false
    clear()
  }

  // Scrolling moves the page under a still pointer: hit-test again as well as re-measure.
  function onViewportChange() {
    if (!isActive() || (!hovered && !pointer)) return
    if (pointer) resolveAtPointer()
    schedule()
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Alt') {
      altHeld = true
      if (hovered) schedule()
      return
    }
    if (event.key === 'Escape') {
      if (!hovered || !isActive()) return
      dismissed = true
      clear()
      return
    }
    const backslash = event.key === '\\' || event.code === 'Backslash'
    if (!backslash || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
    if (!available || destroyed) return
    event.preventDefault()
    enabled = !enabled
    storeEnabled(enabled)
    const shortcut = isMac() ? '⌘\\' : 'Ctrl+\\'
    showToast(enabled ? `Click to edit on · ${shortcut}` : `Click to edit off · ${shortcut}`)
    if (enabled) {
      dismissed = false
      resolveAtPointer()
    }
    schedule()
  }

  function onKeyUp(event: KeyboardEvent) {
    if (event.key !== 'Alt') return
    altHeld = false
    if (!isActive()) return
    resolveAtPointer()
    schedule()
  }

  function onBlur() {
    altHeld = false
  }

  /** An unmodified primary press on an editable element, while click-to-edit is on. */
  function interceptable(event: MouseEvent) {
    if (!isActive() || event.button !== 0) return null
    if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return null
    return findSanityTarget(event.target)
  }

  function swallow(event: Event) {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
  }

  function onPointerDown(event: PointerEvent) {
    pressed = null
    if (!event.isPrimary) return
    const target = interceptable(event)
    if (!target) return
    swallow(event)
    // Posted on `click`, with the node as it was pressed, in case the page re-renders between.
    pressed = target.node
  }

  function onPointerUp(event: PointerEvent) {
    if (pressed) swallow(event)
  }

  function onPointerCancel() {
    pressed = null
  }

  // Only clicks that started with an intercepted press: keyboard activation (Enter on a link)
  // still reaches the page.
  function onClick(event: MouseEvent) {
    const node = pressed
    if (!node) return
    pressed = null
    swallow(event)
    options.onEdit(node)
  }

  function onDragStart(event: DragEvent) {
    if (pressed || interceptable(event)) event.preventDefault()
  }

  const capture = {capture: true}
  const passiveCapture = {capture: true, passive: true}
  window.addEventListener('pointermove', onPointerMove, {passive: true})
  window.addEventListener('pointerout', onPointerOut, passiveCapture)
  window.addEventListener('scroll', onViewportChange, passiveCapture)
  window.addEventListener('resize', onViewportChange, {passive: true})
  window.addEventListener('keydown', onKeyDown, capture)
  window.addEventListener('keyup', onKeyUp, capture)
  window.addEventListener('blur', onBlur)
  window.addEventListener('pointerdown', onPointerDown, capture)
  window.addEventListener('pointerup', onPointerUp, capture)
  window.addEventListener('pointercancel', onPointerCancel, capture)
  window.addEventListener('click', onClick, capture)
  window.addEventListener('dragstart', onDragStart, capture)

  return {
    setActive(next) {
      if (destroyed || next === available) return
      available = next
      pressed = null
      if (!isActive()) {
        clear()
        return
      }
      dismissed = false
      resolveAtPointer()
      schedule()
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      cancelAnimationFrame(frame)
      clearTimeout(toastTimer)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerout', onPointerOut, passiveCapture)
      window.removeEventListener('scroll', onViewportChange, passiveCapture)
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('keydown', onKeyDown, capture)
      window.removeEventListener('keyup', onKeyUp, capture)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('pointerdown', onPointerDown, capture)
      window.removeEventListener('pointerup', onPointerUp, capture)
      window.removeEventListener('pointercancel', onPointerCancel, capture)
      window.removeEventListener('click', onClick, capture)
      window.removeEventListener('dragstart', onDragStart, capture)
      layer.remove()
    },
  }
}
