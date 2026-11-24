import {describe, expect, test, vi} from 'vitest'
import {
  createNodeDescriber,
  describePath,
  type LabelSchema,
  type LabelSchemaType,
} from '../src/core/node-labels'
import {isInspectorShortcut, isPreviewBarMessage} from '../src/core/protocol'
import {matchFocusedNodes, parseSanityNode, toUrlPath} from '../src/core/sanity-node'

const string = (title?: string): LabelSchemaType => ({name: 'string', jsonType: 'string', title})

const imageHero: LabelSchemaType = {
  name: 'imageHero',
  title: 'Image Hero',
  jsonType: 'object',
  fields: [
    {name: 'title', type: string('Title')},
    {name: 'link', type: {name: 'link', title: 'Link', jsonType: 'object', fields: []}},
  ],
}
const block: LabelSchemaType = {
  name: 'block',
  jsonType: 'object',
  fields: [
    {
      name: 'style',
      type: {
        name: 'string',
        options: {
          list: [
            {title: 'Normal', value: 'normal'},
            {title: 'Heading 1', value: 'h1'},
          ],
        },
      },
    },
  ],
}
const product: LabelSchemaType = {name: 'product', title: 'Product', jsonType: 'object'}
const page: LabelSchemaType = {
  name: 'page',
  title: 'Page',
  jsonType: 'object',
  fields: [
    {name: 'title', type: string()},
    {
      name: 'sections',
      type: {
        name: 'array',
        title: 'Sections',
        jsonType: 'array',
        of: [
          imageHero,
          {
            name: 'collections',
            title: 'Collections',
            jsonType: 'object',
            fields: [
              {
                name: 'content',
                type: {name: 'array', jsonType: 'array', title: 'Content', of: [block]},
              },
              {
                name: 'products',
                type: {
                  name: 'array',
                  jsonType: 'array',
                  title: 'Products',
                  of: [{name: 'reference', jsonType: 'object', to: [product]}],
                },
              },
            ],
          },
        ],
      },
    },
  ],
}
const schema: LabelSchema = {get: (name) => (name === 'page' ? page : undefined)}

const homepage = {
  _id: 'home',
  _type: 'page',
  title: 'Homepage',
  sections: [
    {_key: 'hero', _type: 'imageHero', title: 'Meet our makers'},
    {
      _key: 'shop',
      _type: 'collections',
      content: [{_key: 'b1', _type: 'block', style: 'h1'}],
      products: [{_key: 'p0', _type: 'reference', _ref: 'product-1'}],
    },
  ],
}

describe('toUrlPath', () => {
  test('is the inverse of the URL form', () => {
    expect(toUrlPath(['sections', {_key: 'k1'}, 'heading'])).toBe('sections:k1.heading')
    expect(toUrlPath(['items', 3, 'title'])).toBe('items:3.title')
    expect(toUrlPath(['rows', {_key: 'r1'}, {_key: 'c2'}])).toBe('rows:r1:c2')
    expect(toUrlPath([])).toBe('')
  })
})

describe('matchFocusedNodes', () => {
  const items = [
    'id=home;type=page;path=sections:hero',
    'id=home;type=page;path=sections:hero.title',
    'id=home;type=page;path=sections:hero.title',
    'id=home;type=page;path=sections:shop',
    'id=footer;type=footer;path=sections:hero.title',
  ].map((value, index) => ({index, node: parseSanityNode(value)!}))

  test('matches the field, everywhere it renders', () => {
    const matched = matchFocusedNodes(items, {id: 'home', path: 'sections:hero.title'})
    expect(matched.map((item) => item.index)).toEqual([1, 2])
  })

  test('falls back to the nearest annotated element around a deeper field', () => {
    const matched = matchFocusedNodes(items, {
      id: 'drafts.home',
      path: 'sections:shop.content:b1.children:s1',
    })
    expect(matched.map((item) => item.index)).toEqual([3])
  })

  test('nothing for another document or an empty path', () => {
    expect(matchFocusedNodes(items, {id: 'other', path: 'sections:hero.title'})).toEqual([])
    expect(matchFocusedNodes(items, {id: 'home', path: ''})).toEqual([])
  })
})

describe('describePath', () => {
  test('field titles, and array items by their type', () => {
    expect(describePath(schema, 'page', homepage, 'sections:hero.title')).toEqual({
      label: 'Title',
      missing: false,
    })
    expect(describePath(schema, 'page', homepage, 'sections:hero')).toEqual({
      label: 'Image Hero',
      missing: false,
    })
    expect(describePath(schema, 'page', homepage, 'title').label).toBe('Title')
  })

  test('blocks by their style, references by what they point to', () => {
    expect(describePath(schema, 'page', homepage, 'sections:shop.content:b1').label).toBe(
      'Heading 1',
    )
    expect(describePath(schema, 'page', homepage, 'sections:shop.products:p0').label).toBe(
      'Product',
    )
  })

  test('drift: a field the schema lacks, a missing item, a missing document', () => {
    expect(describePath(schema, 'page', homepage, 'sections:hero.subtitle')).toEqual({
      label: 'Subtitle',
      missing: true,
    })
    expect(describePath(schema, 'page', homepage, 'sections:gone.title')).toEqual({
      label: 'Sections item',
      missing: true,
    })
    expect(describePath(schema, 'page', null, 'title').missing).toBe(true)
    expect(describePath(schema, 'unknownType', homepage, 'title').missing).toBe(true)
  })

  test('without the document, only the schema is checked', () => {
    expect(describePath(schema, 'page', undefined, 'sections:any.title')).toEqual({
      label: 'Title',
      missing: false,
    })
  })
})

describe('createNodeDescriber', () => {
  test('fetches each document once while cached, and echoes the nodes', async () => {
    const fetchDocuments = vi.fn(async (ids: string[]) =>
      Object.fromEntries(ids.filter((id) => id === 'home').map((id) => [id, homepage])),
    )
    const describe = createNodeDescriber(schema, fetchDocuments)
    const nodes = [
      {id: 'home', type: 'page', path: 'sections:hero.title'},
      {id: 'drafts.home', type: 'page', path: 'sections:nope.title'},
      {id: 'missing-doc', type: 'page', path: 'title'},
    ]
    expect(await describe(nodes)).toEqual([
      {id: 'home', path: 'sections:hero.title', label: 'Title'},
      {id: 'drafts.home', path: 'sections:nope.title', label: 'Sections item', missing: true},
      {id: 'missing-doc', path: 'title', label: 'Title', missing: true},
    ])
    await describe(nodes)
    expect(fetchDocuments).toHaveBeenCalledTimes(1)
    expect(fetchDocuments).toHaveBeenCalledWith(['home', 'missing-doc'])
  })
})

describe('phase 2 messages', () => {
  test('focus carries an id and a path, both empty to clear', () => {
    expect(
      isPreviewBarMessage({type: 'sanity-preview-bar:focus', id: 'home', path: 'sections:k1'}),
    ).toBe(true)
    expect(isPreviewBarMessage({type: 'sanity-preview-bar:focus', id: '', path: ''})).toBe(true)
    expect(isPreviewBarMessage({type: 'sanity-preview-bar:focus', id: 'home'})).toBe(false)
    expect(
      isPreviewBarMessage({type: 'sanity-preview-bar:focus', id: 'a', path: 'a'.repeat(1001)}),
    ).toBe(false)
  })

  test('describe carries valid nodes, at most 500', () => {
    const node = {id: 'home', type: 'page', path: 'title'}
    expect(isPreviewBarMessage({type: 'sanity-preview-bar:describe', nodes: [node]})).toBe(true)
    expect(isPreviewBarMessage({type: 'sanity-preview-bar:describe', nodes: [{id: 'home'}]})).toBe(
      false,
    )
    expect(
      isPreviewBarMessage({type: 'sanity-preview-bar:describe', nodes: Array(501).fill(node)}),
    ).toBe(false)
  })

  test('labels carry an id, path, label and optional drift flag', () => {
    const labels = (items: unknown[]) =>
      isPreviewBarMessage({type: 'sanity-preview-bar:labels', labels: items})
    expect(labels([{id: 'home', path: 'title', label: 'Title'}])).toBe(true)
    expect(labels([{id: 'home', path: 'title', label: 'Title', missing: true}])).toBe(true)
    expect(labels([{id: 'home', path: 'title', label: 7}])).toBe(false)
    expect(labels([{id: 'home', path: 'title', label: 'x', missing: 'yes'}])).toBe(false)
    expect(labels([{id: 'home', path: 'title', label: 'x'.repeat(201)}])).toBe(false)
  })
})

describe('the inspector', () => {
  test('messages', () => {
    expect(isPreviewBarMessage({type: 'sanity-preview-bar:inspector', active: true})).toBe(true)
    expect(isPreviewBarMessage({type: 'sanity-preview-bar:inspector', active: 'yes'})).toBe(false)
    expect(isPreviewBarMessage({type: 'sanity-preview-bar:inspector'})).toBe(false)
    expect(isPreviewBarMessage({type: 'sanity-preview-bar:toggle-inspector'})).toBe(true)
  })

  test('⌘⇧I or Ctrl+Shift+I, not repeated, not with Alt', () => {
    const key = (fields: Partial<Parameters<typeof isInspectorShortcut>[0]>) =>
      isInspectorShortcut({
        key: 'I',
        metaKey: false,
        ctrlKey: false,
        shiftKey: true,
        altKey: false,
        ...fields,
      })
    expect(key({metaKey: true})).toBe(true)
    expect(key({ctrlKey: true})).toBe(true)
    expect(key({metaKey: true, key: 'Dead', code: 'KeyI'})).toBe(true)
    expect(key({})).toBe(false)
    expect(key({metaKey: true, shiftKey: false})).toBe(false)
    expect(key({metaKey: true, altKey: true})).toBe(false)
    expect(key({metaKey: true, repeat: true})).toBe(false)
  })
})
