import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { LoginBody, NotificationListBody } from '@egg-booking/contracts'
import { buildApp } from '../src/app.js'
import { collections } from '../src/db/collections.js'

const mongoUri = process.env.MONGO_TEST_URI
const integration = mongoUri ? describe : describe.skip
const dbName = `egg_booking_notifications_test_${Date.now()}`

integration('notification pagination with MongoDB', () => {
  const app = buildApp({
    mongo: { uri: mongoUri!, dbName },
    auth: {
      exchangeWechatCode: async () => ({ openid: 'notification-member' }),
      sessionSecret: 'integration-test-secret',
      sessionTtlDays: 30,
    },
  })
  let login!: LoginBody

  beforeAll(async () => {
    await app.ready()
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/wechat-login',
      payload: { code: 'member' },
    })
    login = response.json<LoginBody>()
    const user = await collections(app.mongo.db).users.findOneAndUpdate(
      { openid: 'notification-member' },
      { $set: { memberStatus: 'approved' } },
      { returnDocument: 'after' },
    )
    if (!user) throw new Error('test user missing')

    const expiresAt = new Date('2027-10-10T00:00:00.000Z')
    await collections(app.mongo.db).notifications.insertMany(
      Array.from({ length: 5 }, (_, index) => ({
        receiverId: user._id,
        type: 'test',
        title: `通知 ${index + 1}`,
        content: `内容 ${index + 1}`,
        isRead: index >= 3,
        createdAt: new Date(`2026-10-10T0${index}:00:00.000Z`),
        expiresAt,
      })),
    )
  })

  afterAll(async () => {
    await app.mongo.db.dropDatabase()
    await app.close()
  })

  it('returns stable pages with totals and unread count', async () => {
    const headers = { authorization: `Bearer ${login.token}` }
    const firstResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications?page=1&limit=2',
      headers,
    })
    expect(firstResponse.statusCode, firstResponse.body).toBe(200)
    expect(firstResponse.json<NotificationListBody>()).toMatchObject({
      page: 1,
      limit: 2,
      totalCount: 5,
      totalPages: 3,
      hasMore: true,
      unreadCount: 3,
      items: [{ title: '通知 5' }, { title: '通知 4' }],
    })

    const lastResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications?page=3&limit=2',
      headers,
    })
    expect(lastResponse.statusCode, lastResponse.body).toBe(200)
    expect(lastResponse.json<NotificationListBody>()).toMatchObject({
      page: 3,
      totalPages: 3,
      hasMore: false,
      items: [{ title: '通知 1' }],
    })
  })
})
