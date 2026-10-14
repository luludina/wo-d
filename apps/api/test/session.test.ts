import { describe, expect, it } from 'vitest'
import { hashSessionToken } from '../src/auth/session.js'

describe('session token hashing', () => {
  it('is deterministic for the same secret and does not expose the token', () => {
    const token = 'plain-session-token'
    const hash = hashSessionToken(token, 'test-secret')

    expect(hash).toBe(hashSessionToken(token, 'test-secret'))
    expect(hash).not.toContain(token)
    expect(hash).toHaveLength(64)
  })

  it('changes when the server secret changes', () => {
    expect(hashSessionToken('token', 'secret-a')).not.toBe(hashSessionToken('token', 'secret-b'))
  })
})
