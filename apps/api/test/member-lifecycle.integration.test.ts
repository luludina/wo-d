import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { LoginBody } from '@egg-booking/contracts'
import { buildApp } from '../src/app.js'
import { collections } from '../src/db/collections.js'
import { formatBusinessDate, parseBusinessDate, getShanghaiToday } from '../src/domain/business-date.js'

const mongoUri = process.env.MONGO_TEST_URI
const integration = mongoUri ? describe : describe.skip
const dbName = `egg_booking_test_${Date.now()}`

integration('member lifecycle with MongoDB', () => {
  const app = buildApp({
    mongo: { uri: mongoUri!, dbName },
    auth: {
      exchangeWechatCode: async (code) => ({ openid: `test-openid-${code}` }),
      sessionSecret: 'integration-test-secret',
      sessionTtlDays: 30,
    },
  })

  beforeAll(async () => {
    await app.ready()
  })

  afterAll(async () => {
    await app.mongo.db.dropDatabase()
    await app.close()
  })

  async function login(code: string): Promise<LoginBody> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/wechat-login',
      payload: { code },
    })
    expect(response.statusCode).toBe(200)
    return response.json<LoginBody>()
  }

  it('supports application, approval, disabling, relogin, and last-admin protection', async () => {
    const adminLogin = await login('admin')
    await collections(app.mongo.db).users.updateOne(
      { openid: 'test-openid-admin' },
      { $set: { memberStatus: 'approved', isAdmin: true } },
    )

    const memberLogin = await login('member')
    const memberAuthorization = { authorization: `Bearer ${memberLogin.token}` }
    const profileResponse = await app.inject({
      method: 'PUT',
      url: '/api/v1/me/profile',
      headers: memberAuthorization,
      payload: { realName: '测试成员', department: '测试部', phone: null },
    })
    expect(profileResponse.statusCode).toBe(200)

    const applicationResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/me/application',
      headers: memberAuthorization,
    })
    expect(applicationResponse.statusCode).toBe(200)
    expect(applicationResponse.json().memberStatus).toBe('pending')

    const approveResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/members/${memberLogin.user.id}/approve`,
      headers: { authorization: `Bearer ${adminLogin.token}` },
    })
    expect(approveResponse.statusCode).toBe(200)
    expect(approveResponse.json().memberStatus).toBe('approved')

    const tomorrow = formatBusinessDate(
      new Date(parseBusinessDate(getShanghaiToday()).getTime() + 86_400_000),
    )
    const memberDocument = await collections(app.mongo.db).users.findOne({ openid: 'test-openid-member' })
    await collections(app.mongo.db).reservations.insertOne({
      memberId: memberDocument!._id,
      date: tomorrow,
      quantity: 2,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const disableResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/members/${memberLogin.user.id}/disable`,
      headers: { authorization: `Bearer ${adminLogin.token}` },
      payload: { reason: '集成测试' },
    })
    expect(disableResponse.statusCode).toBe(200)
    expect(disableResponse.json().memberStatus).toBe('disabled')
    expect((await collections(app.mongo.db).reservations.findOne({ date: tomorrow }))?.status).toBe(
      'cancelled',
    )

    const oldSessionResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: memberAuthorization,
    })
    expect(oldSessionResponse.statusCode).toBe(401)

    const disabledLogin = await login('member')
    const disabledMeResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${disabledLogin.token}` },
    })
    expect(disabledMeResponse.statusCode).toBe(200)
    expect(disabledMeResponse.json().memberStatus).toBe('disabled')

    const disableLastAdminResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/members/${adminLogin.user.id}/disable`,
      headers: { authorization: `Bearer ${adminLogin.token}` },
      payload: {},
    })
    expect(disableLastAdminResponse.statusCode).toBe(409)
    expect(disableLastAdminResponse.json().code).toBe('LAST_ADMIN_PROTECTED')
  })

  it('revokes the current session on logout', async () => {
    const loginResult = await login('logout-member')
    const authorization = { authorization: `Bearer ${loginResult.token}` }

    const logoutResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: authorization,
    })
    expect(logoutResponse.statusCode).toBe(200)
    expect(logoutResponse.json()).toEqual({ ok: true })

    const meResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: authorization,
    })
    expect(meResponse.statusCode).toBe(401)
  })
})
