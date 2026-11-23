import {describe, expect, test} from 'vitest'

import {findPageDocumentRule, matchRoute} from '../src/core/page-documents'

describe('matchRoute', () => {
  test('literal routes, params and a trailing rest param', () => {
    expect(matchRoute('/', '/')).toEqual({})
    expect(matchRoute('/makers', '/makers')).toEqual({})
    expect(matchRoute('/products/:slug', '/products/simi-mirror')).toEqual({slug: 'simi-mirror'})
    expect(matchRoute('/products/:slug', '/products/simi-mirror?variant=1')).toEqual({
      slug: 'simi-mirror',
    })
    expect(matchRoute('/:slug', '/caf%C3%A9')).toEqual({slug: 'café'})
    expect(matchRoute('/docs/:rest*', '/docs/a/b')).toEqual({rest: 'a/b'})
  })

  test('different lengths and literals do not match', () => {
    expect(matchRoute('/products/:slug', '/products')).toBeNull()
    expect(matchRoute('/products/:slug', '/products/a/b')).toBeNull()
    expect(matchRoute('/makers', '/collections')).toBeNull()
  })
})

describe('findPageDocumentRule', () => {
  const rules = [
    {route: '/', filter: 'home'},
    {route: '/collections/all', filter: 'shop'},
    {route: '/collections/:slug', filter: 'collection'},
    {route: ['/search', '/search/products'], filter: 'search'},
    {route: '/:catchall', filter: 'notFound', params: {extra: 'x'}},
  ]

  test('the first matching rule wins, as in Presentation', () => {
    expect(findPageDocumentRule(rules, '/collections/all')).toEqual({filter: 'shop', params: {}})
    expect(findPageDocumentRule(rules, '/collections/seating')).toEqual({
      filter: 'collection',
      params: {slug: 'seating'},
    })
    expect(findPageDocumentRule(rules, '/search/products')?.filter).toBe('search')
  })

  test('rule params merge over route params; no match is null', () => {
    expect(findPageDocumentRule(rules, '/nope')).toEqual({
      filter: 'notFound',
      params: {catchall: 'nope', extra: 'x'},
    })
    expect(findPageDocumentRule(rules, '/a/b/c')).toBeNull()
  })
})

describe('findPageDocumentRule with every DocumentResolver form', () => {
  test('a type rule finds the document of that type', () => {
    expect(findPageDocumentRule([{route: '/cart', type: 'cart'}], '/cart')).toEqual({
      filter: '_type == $type',
      params: {type: 'cart'},
    })
  })

  test('filter and params functions get the origin, route params and path', () => {
    const rule = {
      route: '/blog/:category/:slug',
      filter: ({params}: {params: Record<string, string>}) => `slug == "${params.slug}"`,
      params: ({origin, path}: {origin: string; path: string}) => ({origin, path}),
    }
    expect(findPageDocumentRule([rule], '/blog/tech/hello?x=1', 'https://a.test')).toEqual({
      filter: 'slug == "hello"',
      params: {
        category: 'tech',
        slug: 'hello',
        origin: 'https://a.test',
        path: '/blog/tech/hello',
      },
    })
  })

  test('a resolve rule that returns nothing falls through to the next rule', () => {
    const rules = [
      {route: '/products/:id', resolve: () => undefined},
      {
        route: '/products/:id',
        resolve: ({params}: {params: Record<string, string>}) => ({
          filter: '_id == $id',
          params: {id: `product-${params.id}`},
        }),
      },
    ]
    expect(findPageDocumentRule(rules, '/products/7')).toEqual({
      filter: '_id == $id',
      params: {id: 'product-7'},
    })
  })
})
