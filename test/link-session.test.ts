import {describe, expect, test} from 'vitest'

import {signLinkSession, verifyLinkSession} from '../src/server/link-session'

const now = Date.parse('2026-11-13T12:00:00Z')
const expiresAt = now + 60 * 60 * 1000

describe('link-session cookies', () => {
  test('verify until they expire', async () => {
    const value = await signLinkSession('secret', expiresAt)
    expect(value).toMatch(/^\d+\.[A-Za-z0-9_-]+$/)
    expect(value).not.toContain('secret')
    expect(await verifyLinkSession('secret', value, now)).toBe(expiresAt)
    expect(await verifyLinkSession('secret', value, expiresAt)).toBeNull()
  })

  test('reject another key, a changed expiry and junk', async () => {
    const value = await signLinkSession('secret', expiresAt)
    const [expires, signature] = value.split('.')
    expect(await verifyLinkSession('other', value, now)).toBeNull()
    expect(
      await verifyLinkSession('secret', `${Number(expires) + 3600}.${signature}`, now),
    ).toBeNull()
    for (const junk of ['', 'secret', `${expires}.`, `${expires}.!!`, `x.${signature}`, null]) {
      expect(await verifyLinkSession('secret', junk, now)).toBeNull()
    }
  })
})
