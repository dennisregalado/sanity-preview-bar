import {describe, expect, test} from 'vitest'

import {
  buildSearchQuery,
  documentResult,
  parseKinds,
  parseSort,
  prefixLast,
  routeResults,
  type SearchConfig,
  searchKinds,
  thumbnail,
} from '../src/core/link-search'

/** A storefront like the one the bar was built for: routes plus Shopify and Sanity types. */
const config: SearchConfig = {
  routes: [
    {title: 'Homepage', path: '/', emoji: '🏡'},
    {title: 'Makers Landing', path: '/makers', emoji: '🧑‍🎨'},
  ],
  types: [
    {
      type: 'page',
      title: 'Page',
      fields: {title: 'title', slug: 'slug.current'},
      href: (s) => `/pages/${s}`,
    },
    {
      type: 'policy',
      title: 'Policy',
      fields: {title: 'title', subtitle: '"/policies/" + slug.current', slug: 'slug.current'},
      boost: {subtitle: 'slug.current'},
      href: (s) => `/policies/${s}`,
    },
    {
      type: 'product',
      title: 'Product',
      emoji: '🛍️',
      fields: {
        title: 'store.title',
        slug: 'store.slug.current',
        image: 'coalesce(transparentImage.asset->url, store.previewImageUrl)',
      },
      filter: 'store.isDeleted != true',
      href: (s) => `/products/${s}`,
    },
  ],
}

describe('prefixLast', () => {
  test('matches the last term as a prefix, like the Studio', () => {
    expect(prefixLast('chai')).toBe('chai*')
    expect(prefixLast('  lounge  chai ')).toBe('lounge chai*')
    expect(prefixLast('chair*')).toBe('chair*')
    expect(prefixLast('"box chair"')).toBe('"box chair"')
    expect(prefixLast('   ')).toBe('')
  })
})

describe('buildSearchQuery', () => {
  test('a query filters with text::query, boosts preview fields and orders by score', () => {
    const query = buildSearchQuery({
      config,
      types: ['page', 'policy', 'product'],
      hasQuery: true,
      sort: 'best',
    })
    expect(query).toContain('[@, _id] match text::query($q)')
    expect(query).toContain('boost(_type == "product" && store.title match text::query($q), 10)')
    expect(query).toContain('boost(_type == "policy" && slug.current match text::query($q), 5)')
    expect(query).toContain('order(_score desc, _updatedAt desc)')
    expect(query).toContain('(_type != "product" || (store.isDeleted != true))')
    expect(query).toContain(
      '"title": select(_type == "page" => title, _type == "policy" => title, _type == "product" => store.title, null)',
    )
    expect(query).toContain(
      '"image": select(_type == "product" => coalesce(transparentImage.asset->url, store.previewImageUrl), null)',
    )
  })

  test('no query skips scoring; sorts map to created/updated order', () => {
    const empty = buildSearchQuery({config, types: ['page'], hasQuery: false, sort: 'best'})
    expect(empty).not.toContain('score(')
    expect(empty).toContain('order(_updatedAt desc)')
    expect(
      buildSearchQuery({config, types: ['page'], hasQuery: true, sort: 'createdAsc'}),
    ).toContain('order(_createdAt asc)')
  })

  test('rejects type names that could break out of the query', () => {
    const bad: SearchConfig = {
      types: [
        {type: 'x" || true || "', title: 'X', fields: {title: 'a', slug: 'b'}, href: (s) => s},
      ],
    }
    expect(() =>
      buildSearchQuery({config: bad, types: ['x" || true || "'], hasQuery: false, sort: 'best'}),
    ).toThrow(/invalid type name/)
  })
})

describe('documentResult', () => {
  const base = {
    _id: 'shopifyProduct-1',
    _type: 'product',
    title: 'Box Chair',
    subtitle: null,
    image: 'https://cdn.shopify.com/files/box.png?v=1',
    slug: 'box-chair',
  }

  test('maps to the configured href, badge, thumbnail and draft status', () => {
    const result = documentResult(config, {...base, _originalId: 'drafts.shopifyProduct-1'})
    expect(result).toMatchObject({
      href: '/products/box-chair',
      badge: 'Product',
      status: ['draft'],
      emoji: '🛍️',
    })
    expect(result?.image).toBe('https://cdn.shopify.com/files/box.png?v=1&width=66')
  })

  test('published and release versions, and no slug or unknown type means no result', () => {
    expect(documentResult(config, base)?.status).toEqual(['published'])
    expect(
      documentResult(config, {...base, _originalId: 'versions.rX.shopifyProduct-1'})?.status,
    ).toEqual(['version'])
    const existing = new Set(['shopifyProduct-1', 'drafts.shopifyProduct-1'])
    expect(
      documentResult(config, {...base, _originalId: 'drafts.shopifyProduct-1'}, existing)?.status,
    ).toEqual(['draft', 'published'])
    expect(documentResult(config, {...base, slug: null})).toBeNull()
    expect(documentResult(config, {...base, _type: 'unknown'})).toBeNull()
  })

  test('Sanity images are resized for the 33px media box; junk URLs are dropped', () => {
    expect(thumbnail('https://cdn.sanity.io/images/p/d/a.jpg')).toBe(
      'https://cdn.sanity.io/images/p/d/a.jpg?w=66&h=66&fit=max&auto=format',
    )
    expect(thumbnail('not a url')).toBeNull()
    expect(thumbnail(null)).toBeNull()
  })
})

describe('routes and params', () => {
  test('fixed routes match by title; empty shows all of them', () => {
    expect(routeResults(config, '').length).toBe(2)
    expect(routeResults(config, 'mak').map((r) => r.href)).toEqual(['/makers'])
  })

  test('kinds come from the config, routes first', () => {
    expect(searchKinds(config)).toEqual([
      {kind: 'route', title: 'Route'},
      {kind: 'page', title: 'Page'},
      {kind: 'policy', title: 'Policy'},
      {kind: 'product', title: 'Product'},
    ])
    expect(searchKinds({types: config.types})[0]).toEqual({kind: 'page', title: 'Page'})
  })

  test('invalid kinds and sorts fall back to defaults', () => {
    expect(parseKinds(config, 'product,nope')).toEqual(['product'])
    expect(parseKinds(config, 'nope')).toEqual(['route', 'page', 'policy', 'product'])
    expect(parseSort('updatedDesc')).toBe('updatedDesc')
    expect(parseSort('raw')).toBe('best')
  })
})
