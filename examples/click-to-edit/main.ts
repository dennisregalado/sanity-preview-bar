/**
 * Click-to-edit on its own, without the bar: `npm run example`. The engine posts nothing here;
 * `onEdit` logs the message the host or framed site would send, and the pane path the bar or the
 * Visual Editor tool would open.
 */
import type {PreviewBarMessage} from '../../src/core/protocol'
import {toPanePath} from '../../src/core/sanity-node'
import {mountClickToEdit} from '../../src/host/overlay'

const log = document.getElementById('log')!
function write(line: string) {
  log.textContent = `${line}\n${log.textContent}`
}

const clickToEdit = mountClickToEdit({
  onEdit(node) {
    const message: PreviewBarMessage = {
      type: 'sanity-preview-bar:edit',
      id: node.id,
      documentType: node.type,
      path: node.path,
    }
    write(`${JSON.stringify(message)}\n  → pane path ${toPanePath(node.path)}`)
  },
})

// The site turns click-to-edit on only while the document pane is open.
const active = document.getElementById('active') as HTMLInputElement
active.addEventListener('change', () => clickToEdit.setActive(active.checked))

// Links that do get followed (Alt-click, or no `data-sanity`) show up here.
window.addEventListener('hashchange', () => write(`link followed: ${location.hash}`))

// A live preview replacing an element under a still pointer, as the realtime hub does.
const rerender = document.getElementById('rerender') as HTMLInputElement
let timer: ReturnType<typeof setInterval> | undefined
let count = 0
rerender.addEventListener('change', () => {
  clearInterval(timer)
  if (!rerender.checked) return
  timer = setInterval(() => {
    const heading = document.getElementById('hero-heading')!
    const next = heading.cloneNode() as HTMLElement
    next.textContent = `Furniture made in Los Angeles (${++count})`
    heading.replaceWith(next)
  }, 300)
})

Object.assign(window, {clickToEdit})
