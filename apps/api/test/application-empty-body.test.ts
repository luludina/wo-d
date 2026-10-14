import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'

describe('member application request body', () => {
  it('returns a client error instead of an internal error for an empty JSON body', async () => {
    const app = buildApp()
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/me/application',
      headers: { 'content-type': 'application/json' },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().code).toBe('VALIDATION_ERROR')
    await app.close()
  })
})
