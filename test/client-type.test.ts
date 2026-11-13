import {createClient, type SanityClient} from '@sanity/client'
import {expect, test} from 'vitest'

import type {PreviewClient} from '../src/server'

test('a real SanityClient satisfies PreviewClient (checked by tsc)', () => {
  const client: SanityClient = createClient({projectId: 'p', dataset: 'd', useCdn: false})
  const preview: PreviewClient = client
  const perspectiveClient: PreviewClient = client.withConfig({perspective: ['rX', 'drafts']})
  expect(typeof preview.fetch).toBe('function')
  expect(typeof perspectiveClient.withConfig).toBe('function')
})
