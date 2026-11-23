import {fromString, toString} from '@sanity/util/paths'
import {describe, expect, test, vi} from 'vitest'
import type {PanelEntry} from '../src/bar/DocumentPanel'
import {applyEdit, editStack} from '../src/bar/pane-state'
import {isPreviewBarMessage} from '../src/core/protocol'
import {
  describeSanityPath,
  humanizeFieldName,
  parseSanityNode,
  studioPathToString,
  toPanePath,
  toStudioPath,
} from '../src/core/sanity-node'

describe('parseSanityNode', () => {
  test('reads id, type and path', () => {
    expect(parseSanityNode('id=page-home;type=page;path=sections:k1.heading')).toEqual({
      id: 'page-home',
      type: 'page',
      path: 'sections:k1.heading',
    })
  })

  test('keeps base and workspace, and ignores unknown keys', () => {
    expect(
      parseSanityNode('id=a;type=product;path=title;base=%2Fstudio;workspace=staging;x=1'),
    ).toEqual({id: 'a', type: 'product', path: 'title', base: '/studio', workspace: 'staging'})
  })

  test('splits each pair on its first `=` and URI-decodes values', () => {
    expect(parseSanityNode('id=drafts.a%3Db;type=page;path=seo.title%3Dx')).toMatchObject({
      id: 'drafts.a=b',
      path: 'seo.title=x',
    })
    expect(parseSanityNode('id=a=b;type=page;path=title')?.id).toBe('a=b')
  })

  test('order does not matter, stray separators are skipped', () => {
    expect(parseSanityNode(';path=title;;type=page;id=a;junk')).toEqual({
      id: 'a',
      type: 'page',
      path: 'title',
    })
  })

  test('needs a non-empty id, type and path', () => {
    for (const value of [
      null,
      undefined,
      '',
      'type=page;path=title',
      'id=a;path=title',
      'id=a;type=page',
      'id=;type=page;path=title',
      'id=a;type=page;path=',
      // A malformed escape is dropped, not thrown.
      'id=%E0%A4%A;type=page;path=title',
      `id=a;type=page;path=${'a'.repeat(1001)}`,
    ]) {
      expect(parseSanityNode(value)).toBeNull()
    }
  })
})

describe('toStudioPath', () => {
  test('fields, keyed items and indexes', () => {
    expect(toStudioPath('title')).toEqual(['title'])
    expect(toStudioPath('seo.title')).toEqual(['seo', 'title'])
    expect(toStudioPath('sections:k1.heading')).toEqual(['sections', {_key: 'k1'}, 'heading'])
    expect(toStudioPath('sections:k1')).toEqual(['sections', {_key: 'k1'}])
    expect(toStudioPath('items:3.title')).toEqual(['items', 3, 'title'])
    expect(toStudioPath('rows:r1:c2.text')).toEqual(['rows', {_key: 'r1'}, {_key: 'c2'}, 'text'])
  })

  test('up to 9 digits is an index; longer or mixed is a key', () => {
    expect(toStudioPath('items:123456789')).toEqual(['items', 123456789])
    expect(toStudioPath('items:1234567890')).toEqual(['items', {_key: '1234567890'}])
    expect(toStudioPath('items:3a')).toEqual(['items', {_key: '3a'}])
  })

  test('rejects empty and malformed paths', () => {
    for (const path of ['', '.title', 'title.', 'a..b', ':k1', 'items:', 'items::k1']) {
      expect(toStudioPath(path)).toBeNull()
    }
  })
})

describe('the pane path param', () => {
  test('matches @sanity/util/paths toString', () => {
    expect(studioPathToString(['sections', {_key: 'k1'}, 'heading'])).toBe(
      'sections[_key=="k1"].heading',
    )
    expect(studioPathToString(['items', 3])).toBe('items[3]')
    expect(toPanePath('rows:r1:c2.text')).toBe('rows[_key=="r1"][_key=="c2"].text')
    expect(toPanePath('')).toBeNull()
  })
})

test('the pane param round-trips through the installed @sanity/util/paths', () => {
  for (const urlPath of ['title', 'sections:k1.heading', 'items:3.title', 'rows:r1:c2.text']) {
    const path = toStudioPath(urlPath)!
    expect(toPanePath(urlPath)).toBe(toString(path))
    expect(fromString(toPanePath(urlPath)!)).toEqual(path)
  }
})

describe('labels', () => {
  test('humanizes field names', () => {
    expect(humanizeFieldName('heading')).toBe('Heading')
    expect(humanizeFieldName('heroImage')).toBe('Hero image')
    expect(humanizeFieldName('section_title')).toBe('Section title')
    expect(humanizeFieldName('seoCTA')).toBe('Seo CTA')
  })

  test('describes the last segment', () => {
    expect(describeSanityPath('sections:k1.heading')).toBe('Heading')
    expect(describeSanityPath('sections:k1')).toBe('Sections item')
    expect(describeSanityPath('gallery:k1:k2')).toBe('Gallery item')
  })
})

describe('the edit message', () => {
  const edit = (fields: Record<string, unknown>) =>
    isPreviewBarMessage({type: 'sanity-preview-bar:edit', ...fields})

  test('needs a non-empty id, document type and path', () => {
    expect(edit({id: 'page-home', documentType: 'page', path: 'sections:k1.heading'})).toBe(true)
    expect(edit({id: '', documentType: 'page', path: 'title'})).toBe(false)
    expect(edit({id: 'a', documentType: '', path: 'title'})).toBe(false)
    expect(edit({id: 'a', documentType: 'page', path: ''})).toBe(false)
    expect(edit({id: 'a', documentType: 'page'})).toBe(false)
    expect(edit({id: 'a', type: 'page', path: 'title'})).toBe(false)
    expect(edit({id: 7, documentType: 'page', path: 'title'})).toBe(false)
    expect(edit({id: 'a', documentType: 'page', path: ['title']})).toBe(false)
  })

  test('caps the path at 1000 characters', () => {
    expect(edit({id: 'a', documentType: 'page', path: 'a'.repeat(1000)})).toBe(true)
    expect(edit({id: 'a', documentType: 'page', path: 'a'.repeat(1001)})).toBe(false)
  })
})

describe('editStack', () => {
  const page = {id: 'page-home', type: 'page', params: {inspect: 'history'}}
  const product = {id: 'product-1', type: 'product', params: {}}

  test("opens the page's document at the path, dropping anything above it", () => {
    expect(
      editStack(
        [page, product],
        {id: 'drafts.page-home', documentType: 'page', path: 'sections:k1.heading'},
        'page-home',
      ),
    ).toEqual([
      {
        id: 'page-home',
        type: 'page',
        params: {inspect: 'history', path: 'sections[_key=="k1"].heading'},
      },
    ])
    expect(
      editStack([], {id: 'page-home', documentType: 'page', path: 'title'}, 'page-home'),
    ).toEqual([{id: 'page-home', type: 'page', params: {path: 'title'}}])
  })

  test('puts another document on top, or moves the top one to the path', () => {
    const pushed = editStack(
      [page],
      {id: 'product-1', documentType: 'product', path: 'title'},
      'page-home',
    )
    expect(pushed).toEqual([page, {id: 'product-1', type: 'product', params: {path: 'title'}}])
    expect(
      editStack(pushed!, {id: 'product-1', documentType: 'product', path: 'images:3'}, 'page-home'),
    ).toEqual([page, {id: 'product-1', type: 'product', params: {path: 'images[3]'}}])
  })

  test('ignores a path that does not parse', () => {
    expect(editStack([page], {id: 'a', documentType: 'page', path: 'a..b'}, 'page-home')).toBeNull()
  })
})

describe('applyEdit', () => {
  const page: PanelEntry = {id: 'page-home', type: 'page', params: {}}

  function run(initial: PanelEntry[], request: Parameters<typeof applyEdit>[1]) {
    let stack = initial
    const paths: unknown[] = []
    applyEdit(stack, request, 'page-home', (update) => {
      stack = update(stack)
      paths.push(stack[stack.length - 1]?.params.path)
    })
    return {paths}
  }

  test('a pane that mounts gets the path at once', () => {
    const {paths} = run([page], {id: 'product-1', documentType: 'product', path: 'images:k1'})
    expect(paths).toEqual(['images[_key=="k1"]'])
  })

  test('a mounted pane steps through the parent, or a placeholder field at the top level', () => {
    vi.useFakeTimers()
    try {
      const nested = run([page], {
        id: 'page-home',
        documentType: 'page',
        path: 'sections:k1.heading',
      })
      vi.runAllTimers()
      expect(nested.paths).toEqual(['sections[_key=="k1"]', 'sections[_key=="k1"].heading'])

      const top = run([page], {id: 'page-home', documentType: 'page', path: 'title'})
      vi.runAllTimers()
      expect(top.paths).toEqual(['_previewBarRefocus', 'title'])
    } finally {
      vi.useRealTimers()
    }
  })
})
