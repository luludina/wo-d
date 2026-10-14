import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'

const apps: ReturnType<typeof buildApp>[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe('health routes', () => {
  it('reports the process as live', async () => {
    const app = buildApp()
    apps.push(app)

    const response = await app.inject({
      method: 'GET',
      url: '/health/live',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok' })
  })

  it('reports unavailable when MongoDB is not registered', async () => {
    const app = buildApp()
    apps.push(app)

    const response = await app.inject({
      method: 'GET',
      url: '/health/ready',
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ status: 'unavailable' })
  })
})
