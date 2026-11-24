/**
 * Click-to-edit on its own, without the bar: `npm run example`. The engine posts nothing here;
 * `onEdit` logs the message the host or framed site would send, and the pane path the bar or the
 * Visual Editor tool would open. A stand-in schema and documents answer `onDescribe`, as the
 * Studio's do in the bar and the tool.
 */
import {createNodeDescriber, type LabelSchemaType} from '../../src/core/node-labels'
import type {PreviewBarMessage} from '../../src/core/protocol'
import {toPanePath} from '../../src/core/sanity-node'
import {mountClickToEdit} from '../../src/host/overlay'

const log = document.getElementById('log')!
function write(line: string) {
  log.textContent = `${line}\n${log.textContent}`
}

const field = (name: string, title: string, type: Partial<LabelSchemaType> = {}) => ({
  name,
  type: {name: 'string', jsonType: 'string', title, ...type},
})
const section = (name: string, title: string, fields: ReturnType<typeof field>[]) => ({
  name,
  title,
  jsonType: 'object',
  fields,
})
const types: Record<string, LabelSchemaType> = {
  siteSettings: {
    name: 'siteSettings',
    fields: [
      field('header', 'Header'),
      field('title', 'Site title'),
      field('menu', 'Menu', {
        name: 'array',
        jsonType: 'array',
        of: [section('menuItem', 'Menu item', [field('label', 'Label')])],
      }),
    ],
  },
  page: {
    name: 'page',
    fields: [
      field('sections', 'Sections', {
        name: 'array',
        jsonType: 'array',
        of: [
          section('hero', 'Hero', [field('heading', 'Heading'), field('body', 'Body')]),
          section('featured', 'Featured products', [
            field('heading', 'Heading'),
            field('products', 'Products', {
              name: 'array',
              jsonType: 'array',
              of: [
                {name: 'reference', jsonType: 'object', to: [{name: 'product', title: 'Product'}]},
              ],
            }),
          ]),
          section('makers', 'Makers', [field('heading', 'Heading'), field('body', 'Body')]),
        ],
      }),
    ],
  },
  product: {
    name: 'product',
    fields: [
      field('title', 'Title'),
      field('maker', 'Maker'),
      field('images', 'Images', {
        name: 'array',
        jsonType: 'array',
        of: [{name: 'image', title: 'Image', jsonType: 'object'}],
      }),
    ],
  },
}
const documents: Record<string, unknown> = {
  settings: {_id: 'settings', menu: [{_key: 'm1'}, {_key: 'm2'}]},
  'page-home': {
    _id: 'page-home',
    sections: [
      {_key: 'hero', _type: 'hero'},
      {_key: 'featured', _type: 'featured', products: [{_key: 'p1'}, {_key: 'p2'}]},
      {_key: 'makers', _type: 'makers'},
    ],
  },
  'product-1': {_id: 'product-1'},
  'product-2': {_id: 'product-2', images: [{_key: 'i0'}]},
}
const describe = createNodeDescriber({get: (name) => types[name]}, async (ids) =>
  Object.fromEntries(ids.filter((id) => id in documents).map((id) => [id, documents[id]])),
)

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
  onDescribe(nodes) {
    void describe(nodes).then((labels) => clickToEdit.setLabels(labels))
  },
})

// The Visual Editor turns click-to-edit on with the bar's inspector.
const active = document.getElementById('active') as HTMLInputElement
active.addEventListener('change', () => clickToEdit.setActive(active.checked))

// What the pane reports as the editor moves between fields.
const focus = document.getElementById('focus') as HTMLSelectElement
focus.addEventListener('change', () => {
  const [id, path] = focus.value.split('|')
  clickToEdit.setFocus(id && path ? {id, path} : null)
})

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
