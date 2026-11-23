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
 * (pointer, scroll, resize), until the boxes have settled.
 *
 * Beyond the hover box:
 * - Labels: field titles come from the Studio's schema. The engine asks (`onDescribe`) for the
 *   nodes it shows and the bar or tool answers (`setLabels`); until then, the humanized path.
 * - Focus: the field focused in the document pane (`setFocus`) is outlined on the page, scrolled
 *   into view when none of its elements is on screen.
 * - Drift: while active, the page's nodes are listed when it's idle (one `querySelectorAll`, again
 *   only when the set of annotations changed) and described; any whose path doesn't resolve in the
 *   document gets a dashed red outline and a console warning.
 *
 * Keys: ⌘\ / Ctrl+\ turns it off and on (remembered for the tab); holding Alt/Option hides the
 * outlines and lets clicks through to the page; Esc clears the hover until the pointer moves.
 */
import type {NodeLabel} from '../core/node-labels'
import {MAX_DESCRIBE_NODES} from '../core/protocol'
import {
  describeSanityPath,
  matchFocusedNodes,
  parseSanityNode,
  SANITY_NODE_ATTRIBUTE,
  type SanityNode,
} from '../core/sanity-node'

export type ClickToEditOptions = {
  /** An editable element was clicked. */
  onEdit: (node: SanityNode) => void
  /**
   * Label these nodes and check their paths; answer with `setLabels`. Without it, labels are the
   * humanized path and there is no drift check.
   */
  onDescribe?: (nodes: SanityNode[]) => void
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
  /** Field titles and drift for nodes asked about with `onDescribe`. */
  setLabels(labels: readonly NodeLabel[]): void
  /** The field focused in the document pane (`path` in URL form), or `null`. */
  setFocus(focus: {id: string; path: string} | null): void
  destroy(): void
}

export type SanityTarget = {element: Element; node: SanityNode}

const SELECTOR = `[${SANITY_NODE_ATTRIBUTE}]`
/** One below the bar's wrapper (`2147483000`). */
const OVERLAY_Z_INDEX = 2147482999
const OVERLAY_TAG = 'sanity-preview-bar-overlay'
/** `'0'` while the editor has turned click-to-edit off with ⌘\ for this tab. */
const ENABLED_KEY = 'sanity-preview-bar:click-to-edit'
/** Frames the boxes must hold still before the loop stops (smooth scrolling, transitions). */
const SETTLE_FRAMES = 20
/** Ancestors shown in the label's breadcrumb. */
const MAX_CRUMBS = 3
const TOAST_MS = 1400
/** How often, while active, the page is checked for new or changed annotations (when idle). */
const SCAN_INTERVAL_MS = 4000
/** Most outlines drawn for focus or drift at once. */
const MAX_MARKS = 40

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

/** The editable ancestors above `element`, outermost first. */
function ancestors(element: Element) {
  const found: SanityTarget[] = []
  let current = element.parentElement?.closest(SELECTOR) ?? null
  while (current && found.length < MAX_CRUMBS) {
    const node = parseSanityNode(current.getAttribute(SANITY_NODE_ATTRIBUTE))
    if (node) found.unshift({element: current, node})
    current = current.parentElement?.closest(SELECTOR) ?? null
  }
  return found
}

/** Every node on the page, in document order. */
function scanPage() {
  const targets: SanityTarget[] = []
  for (const element of document.querySelectorAll(SELECTOR)) {
    const node = parseSanityNode(element.getAttribute(SANITY_NODE_ATTRIBUTE))
    if (node) targets.push({element, node})
  }
  return targets
}

const nodeKey = (node: {id: string; path: string}) => `${node.id}\n${node.path}`

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

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

function onScreen(rect: DOMRect) {
  return (
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < window.innerHeight &&
    rect.left < window.innerWidth &&
    (rect.width > 0 || rect.height > 0)
  )
}

const STYLE = `
:host {
  all: initial;
  position: fixed;
  inset: 0;
  pointer-events: none;
  contain: strict;
  --accent: #2276fc;
  --drift: #e5484d;
  font: 500 11px/16px -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif;
}
.box, .mark {
  position: absolute;
  top: 0;
  left: 0;
  display: none;
  box-sizing: border-box;
  border-radius: 2px;
}
.box {
  border: 1px solid var(--accent);
  background: rgb(34 118 252 / 0.06);
}
.mark[data-kind="focus"] { border: 2px solid var(--accent); }
.mark[data-kind="drift"] { border: 1px dashed var(--drift); background: rgb(229 72 77 / 0.05); }
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
.tab[data-missing] { background: var(--drift); }
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
  /** Esc cleared the hover; it comes back when the pointer moves. */
  let dismissed = false

  let hovered: SanityTarget | null = null
  /** What the hover label was last drawn for (attribute and labels), to redraw only on change. */
  let labelFor: string | null = null
  let lastRects = ''
  let stableFrames = 0
  let frame = 0
  let tabWidth = 0
  let tabHeight = 0

  /** A press intercepted on `pointerdown`, posted on its `click`. */
  let pressed: SanityNode | null = null

  /** Labels from the bar or tool, and the nodes asked about but not answered yet. */
  const labels = new Map<string, {label: string; missing?: boolean}>()
  const asked = new Set<string>()
  let toAsk: SanityNode[] = []
  let askQueued = false
  const warned = new Set<string>()

  /** The page's nodes at the last scan, and its annotations as one string to spot changes. */
  let scanned: SanityTarget[] = []
  let scanSignature = ''
  let scanTimer: ReturnType<typeof setTimeout> | undefined
  let idleHandle: number | undefined

  let focus: {id: string; path: string} | null = null
  let focusTargets: SanityTarget[] = []
  let driftTargets: SanityTarget[] = []

  // The layer: one element with an open shadow root, so the page's styles can't reach it.
  const layer = document.createElement(OVERLAY_TAG)
  layer.setAttribute('aria-hidden', 'true')
  layer.style.zIndex = String(options.zIndex ?? OVERLAY_Z_INDEX)
  const shadow = layer.attachShadow({mode: 'open'})
  const style = document.createElement('style')
  style.textContent = STYLE
  const marks = document.createElement('div')
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
  shadow.append(style, marks, box, tab, toast)
  document.body.appendChild(layer)

  const isActive = () => available && enabled && !destroyed

  function schedule() {
    stableFrames = 0
    if (!frame && !destroyed) frame = requestAnimationFrame(tick)
  }

  function hideHover() {
    box.style.display = 'none'
    tab.style.display = 'none'
  }

  function clearHover() {
    hovered = null
    labelFor = null
    hideHover()
  }

  function hideAll() {
    clearHover()
    for (const mark of marks.children) (mark as HTMLElement).style.display = 'none'
    lastRects = ''
  }

  /** Hit-test again where the pointer is, on the next frame (a toggle, Alt released, a scroll). */
  function resolveAtPointer() {
    pointerTarget = null
    needsResolve = true
  }

  function elementAtPointer() {
    return pointer ? document.elementFromPoint(pointer.x, pointer.y) : null
  }

  // Labels.

  function ask(nodes: readonly SanityNode[]) {
    if (!options.onDescribe) return
    for (const node of nodes) {
      const key = nodeKey(node)
      if (labels.has(key) || asked.has(key)) continue
      asked.add(key)
      toAsk.push(node)
    }
    if (toAsk.length && !askQueued) {
      askQueued = true
      queueMicrotask(flushAsk)
    }
  }

  function flushAsk() {
    askQueued = false
    const nodes = toAsk
    toAsk = []
    if (destroyed) return
    for (let start = 0; start < nodes.length; start += MAX_DESCRIBE_NODES)
      options.onDescribe?.(nodes.slice(start, start + MAX_DESCRIBE_NODES))
  }

  function labelOf(node: SanityNode) {
    return labels.get(nodeKey(node))?.label || describeSanityPath(node.path)
  }

  function drawLabel(target: SanityTarget) {
    const above = ancestors(target.element)
    ask([...above.map((item) => item.node), target.node])
    crumbs.textContent = above.map((item) => labelOf(item.node)).join(' › ')
    label.textContent = labelOf(target.node)
    const missing = labels.get(nodeKey(target.node))?.missing
    type.textContent = missing ? `${target.node.type} · not in the document` : target.node.type
    tab.toggleAttribute('data-missing', Boolean(missing))
    tab.style.display = 'flex'
    tabWidth = tab.offsetWidth
    tabHeight = tab.offsetHeight
  }

  // Focus and drift outlines.

  function refreshFocus() {
    focusTargets = focus ? matchFocusedNodes(scanPage(), focus).slice(0, MAX_MARKS) : []
  }

  function refreshDrift() {
    driftTargets = scanned
      .filter((target) => labels.get(nodeKey(target.node))?.missing)
      .slice(0, MAX_MARKS)
    for (const target of driftTargets) {
      const key = nodeKey(target.node)
      if (warned.has(key)) continue
      warned.add(key)
      console.warn(
        `sanity-preview-bar: data-sanity path "${target.node.path}" not found in ${target.node.type} "${target.node.id}"`,
        target.element,
      )
    }
  }

  function scan() {
    idleHandle = undefined
    if (!isActive()) return
    const targets = scanPage()
    const signature = targets
      .map((target) => target.element.getAttribute(SANITY_NODE_ATTRIBUTE))
      .join('\n')
    scanned = targets
    if (signature !== scanSignature) {
      scanSignature = signature
      ask(targets.map((target) => target.node))
    }
    // Re-rendered elements replace the ones outlined.
    refreshDrift()
    if (driftTargets.length) schedule()
    scanTimer = setTimeout(scanWhenIdle, SCAN_INTERVAL_MS)
  }

  function scanWhenIdle() {
    if (!isActive() || !options.onDescribe) return
    if ('requestIdleCallback' in window)
      idleHandle = window.requestIdleCallback(scan, {timeout: 2000})
    else scan()
  }

  function stopScanning() {
    clearTimeout(scanTimer)
    if (idleHandle !== undefined && 'cancelIdleCallback' in window)
      window.cancelIdleCallback(idleHandle)
    idleHandle = undefined
  }

  function markAt(index: number) {
    let mark = marks.children[index] as HTMLElement | undefined
    if (!mark) {
      mark = document.createElement('div')
      mark.className = 'mark'
      marks.appendChild(mark)
    }
    return mark
  }

  function placeBox(element: HTMLElement, rect: DOMRect) {
    Object.assign(element.style, {
      display: 'block',
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      transform: `translate(${rect.left}px, ${rect.top}px)`,
    })
  }

  function placeTab(rect: DOMRect) {
    // The tab sits on the box's top edge, outside it; inside the top when there's no room above
    // (the viewport's edge or a box taller than the screen), and below a short box at the top.
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth
    const left = Math.max(4, Math.min(rect.left, viewportWidth - tabWidth - 4))
    let top = rect.top - tabHeight
    if (top < 0) top = rect.height > tabHeight * 2 ? Math.max(rect.top, 0) : rect.bottom
    tab.style.display = 'flex'
    tab.style.transform = `translate(${left}px, ${top}px)`
  }

  function tick() {
    frame = 0
    if (!isActive() || altHeld) {
      hideAll()
      return
    }

    // Hover.
    if (dismissed) {
      clearHover()
    } else {
      if (needsResolve) {
        needsResolve = false
        hovered = findSanityTarget(pointerTarget ?? elementAtPointer())
        pointerTarget = null
      }
      // A live re-render replaced the hovered element: find what's under the pointer now.
      if (hovered && !hovered.element.isConnected) hovered = findSanityTarget(elementAtPointer())
      if (hovered) {
        // The same element can be re-rendered with another document or path.
        const attribute = hovered.element.getAttribute(SANITY_NODE_ATTRIBUTE)
        const node = parseSanityNode(attribute)
        if (!node) {
          clearHover()
        } else {
          hovered = {element: hovered.element, node}
          const known = labels.get(nodeKey(node))
          const drawnFor = `${attribute}\n${known?.label ?? ''}\n${known?.missing ?? ''}`
          if (drawnFor !== labelFor) {
            labelFor = drawnFor
            lastRects = ''
            drawLabel(hovered)
          }
        }
      } else {
        clearHover()
      }
    }

    // A re-render replaced focused elements: match again.
    if (focus && focusTargets.some((target) => !target.element.isConnected)) refreshFocus()
    driftTargets = driftTargets.filter((target) => target.element.isConnected)

    const outlined = [
      ...focusTargets.map((target) => ({target, kind: 'focus'})),
      ...driftTargets.map((target) => ({target, kind: 'drift'})),
    ]
    const hoverRect = hovered?.element.getBoundingClientRect()
    const rects = outlined.map(({target}) => target.element.getBoundingClientRect())
    const key = [hoverRect, ...rects]
      .map((rect) => (rect ? `${rect.left},${rect.top},${rect.width},${rect.height}` : '-'))
      .join(';')
    if (key !== lastRects) {
      lastRects = key
      stableFrames = 0
      if (hoverRect && (hoverRect.width > 0 || hoverRect.height > 0)) {
        placeBox(box, hoverRect)
        placeTab(hoverRect)
      } else {
        hideHover()
      }
      outlined.forEach(({kind}, index) => {
        const mark = markAt(index)
        mark.dataset.kind = kind
        const rect = rects[index]!
        if (rect.width > 0 || rect.height > 0) placeBox(mark, rect)
        else mark.style.display = 'none'
      })
      for (let index = outlined.length; index < marks.children.length; index++)
        (marks.children[index] as HTMLElement).style.display = 'none'
    } else {
      stableFrames++
    }
    if (stableFrames < SETTLE_FRAMES && (hovered || outlined.length))
      frame = requestAnimationFrame(tick)
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
    clearHover()
    if (isActive()) schedule()
  }

  // Scrolling moves the page under a still pointer: hit-test again as well as re-measure.
  function onViewportChange() {
    if (!isActive()) return
    if (pointer) resolveAtPointer()
    if (hovered || pointer || focusTargets.length || driftTargets.length) schedule()
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Alt') {
      altHeld = true
      schedule()
      return
    }
    if (event.key === 'Escape') {
      if (!hovered || !isActive()) return
      dismissed = true
      schedule()
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
    activated()
  }

  function onKeyUp(event: KeyboardEvent) {
    if (event.key !== 'Alt') return
    altHeld = false
    if (!isActive()) return
    resolveAtPointer()
    schedule()
  }

  function onBlur() {
    if (!altHeld) return
    altHeld = false
    schedule()
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

  /** Active again (the pane opened, ⌘\): hover where the pointer is, outline focus, rescan. */
  function activated() {
    pressed = null
    stopScanning()
    if (!isActive()) {
      hideAll()
      return
    }
    dismissed = false
    resolveAtPointer()
    refreshFocus()
    scanSignature = ''
    scanWhenIdle()
    schedule()
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
  if (isActive()) scanWhenIdle()

  return {
    setActive(next) {
      if (destroyed || next === available) return
      available = next
      activated()
    },
    setLabels(next) {
      if (destroyed) return
      for (const item of next) {
        const key = nodeKey(item)
        asked.delete(key)
        labels.set(key, item.missing ? {label: item.label, missing: true} : {label: item.label})
      }
      refreshDrift()
      labelFor = null
      if (isActive()) schedule()
    },
    setFocus(next) {
      if (destroyed) return
      focus = next && next.id && next.path ? next : null
      refreshFocus()
      if (!isActive()) return
      // Scroll a focused field into view only when none of its elements is on screen.
      const first = focusTargets[0]
      if (first && !focusTargets.some((target) => onScreen(target.element.getBoundingClientRect())))
        first.element.scrollIntoView({
          block: 'center',
          behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        })
      schedule()
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      stopScanning()
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
