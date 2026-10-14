import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type {
  AdminBillRunDetail,
  AdminBillRunListBody,
  BillDetail,
  BillListBody,
  LoginBody,
  NotificationListBody,
} from '@egg-booking/contracts'
import { ObjectId } from 'mongodb'
import { buildApp } from '../src/app.js'
import { collections } from '../src/db/collections.js'
import { generateDueBills } from '../src/domain/billing.js'

const mongoUri = process.env.MONGO_TEST_URI
const integration = mongoUri ? describe : describe.skip
const dbName = `egg_booking_billing_test_${Date.now()}`

integration('weekly billing with MongoDB', () => {
  const app = buildApp({
    mongo: { uri: mongoUri!, dbName },
    auth: {
      exchangeWechatCode: async () => ({ openid: 'billing-member' }),
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
    const { users, reservations } = collections(app.mongo.db)
    const user = await users.findOneAndUpdate(
      { openid: 'billing-member' },
      { $set: { memberStatus: 'approved', nickname: '张三' } },
      { returnDocument: 'after' },
    )
    if (!user) throw new Error('test user missing')
    const now = new Date('2026-10-11T18:00:00+08:00')
    const secondMemberId = new ObjectId()
    await users.insertOne({
      _id: secondMemberId,
      openid: 'billing-member-2',
      nickname: '李四',
      memberStatus: 'approved',
      isAdmin: false,
      createdAt: now,
      updatedAt: now,
    })
    await reservations.insertMany([
      { memberId: user._id, date: '2026-10-08', quantity: 4, status: 'active', createdAt: now, updatedAt: now },
      { memberId: user._id, date: '2026-10-09', quantity: 2, status: 'active', createdAt: now, updatedAt: now },
      { memberId: user._id, date: '2026-10-10', quantity: 3, status: 'active', createdAt: now, updatedAt: now },
      { memberId: user._id, date: '2026-10-11', quantity: 0, status: 'active', createdAt: now, updatedAt: now },
      { memberId: secondMemberId, date: '2026-10-09', quantity: 3, status: 'active', createdAt: now, updatedAt: now },
    ])
  })

  afterAll(async () => {
    await app.mongo.db.dropDatabase()
    await app.close()
  })

  it('generates one immutable bill from effective reservations and a linked notification', async () => {
    const now = new Date('2026-10-11T18:00:00+08:00')
    const firstRun = await generateDueBills(app.mongo.client, app.mongo.db, '2026-10-09', now)
    expect(firstRun).toEqual([
      {
        weekStart: '2026-10-05',
        weekEnd: '2026-10-11',
        generated: true,
        billCount: 2,
        totalQuantity: 5,
        totalAmountFen: 500,
      },
    ])

    const secondRun = await generateDueBills(app.mongo.client, app.mongo.db, '2026-10-09', now)
    expect(secondRun[0]?.generated).toBe(false)
    expect(await collections(app.mongo.db).bills.countDocuments()).toBe(2)

    const headers = { authorization: `Bearer ${login.token}` }
    const listResponse = await app.inject({ method: 'GET', url: '/api/v1/bills', headers })
    expect(listResponse.statusCode, listResponse.body).toBe(200)
    const list = listResponse.json<BillListBody>()
    expect(list.items).toHaveLength(1)
    expect(list.items[0]?.totalQuantity).toBe(2)
    expect(list.items[0]?.totalAmountFen).toBe(200)

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/bills/${list.items[0]!.id}`,
      headers,
    })
    expect(detailResponse.statusCode, detailResponse.body).toBe(200)
    const detail = detailResponse.json<BillDetail>()
    expect(detail.items).toEqual([{ date: '2026-10-09', quantity: 2 }])

    const notificationResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications',
      headers,
    })
    const notifications = notificationResponse.json<NotificationListBody>()
    expect(notifications.items[0]).toMatchObject({
      type: 'bill_generated',
      relatedBillId: list.items[0]!.id,
      isRead: false,
    })

    const nonAdminResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/bills',
      headers,
    })
    expect(nonAdminResponse.statusCode, nonAdminResponse.body).toBe(403)

    await collections(app.mongo.db).users.updateOne(
      { openid: 'billing-member' },
      { $set: { isAdmin: true } },
    )
    const adminListResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/bills',
      headers,
    })
    expect(adminListResponse.statusCode, adminListResponse.body).toBe(200)
    const adminList = adminListResponse.json<AdminBillRunListBody>()
    expect(adminList.items).toEqual([
      expect.objectContaining({
        weekStart: '2026-10-05',
        weekEnd: '2026-10-11',
        memberCount: 2,
        totalQuantity: 5,
        totalAmountFen: 500,
      }),
    ])

    const adminDetailResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/bills/2026-10-05',
      headers,
    })
    expect(adminDetailResponse.statusCode, adminDetailResponse.body).toBe(200)
    const adminDetail = adminDetailResponse.json<AdminBillRunDetail>()
    expect(adminDetail.items).toEqual([
      expect.objectContaining({ nickname: '李四', totalQuantity: 3, totalAmountFen: 300 }),
      expect.objectContaining({ nickname: '张三', totalQuantity: 2, totalAmountFen: 200 }),
    ])

    const invalidWeekResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/bills/not-a-date',
      headers,
    })
    expect(invalidWeekResponse.statusCode, invalidWeekResponse.body).toBe(400)

    const missingWeekResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/bills/2026-09-28',
      headers,
    })
    expect(missingWeekResponse.statusCode, missingWeekResponse.body).toBe(404)
  })
})
