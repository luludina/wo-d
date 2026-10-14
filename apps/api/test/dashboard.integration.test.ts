import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AdminTodaySummaryBody, LoginBody } from '@egg-booking/contracts'
import { ObjectId } from 'mongodb'
import { buildApp } from '../src/app.js'
import { collections } from '../src/db/collections.js'
import {
  formatBusinessDate,
  getShanghaiToday,
  parseBusinessDate,
} from '../src/domain/business-date.js'

const mongoUri = process.env.MONGO_TEST_URI
const integration = mongoUri ? describe : describe.skip
const dbName = `egg_booking_dashboard_test_${Date.now()}`

integration('admin dashboard with MongoDB', () => {
  const app = buildApp({
    mongo: { uri: mongoUri!, dbName },
    auth: {
      exchangeWechatCode: async () => ({ openid: 'dashboard-admin' }),
      sessionSecret: 'integration-test-secret',
      sessionTtlDays: 30,
    },
  })
  let login!: LoginBody
  const today = getShanghaiToday()
  const tomorrow = formatBusinessDate(
    new Date(parseBusinessDate(today).getTime() + 86_400_000),
  )

  beforeAll(async () => {
    await app.ready()
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/wechat-login',
      payload: { code: 'admin' },
    })
    login = response.json<LoginBody>()
    const { users, reservations, mealDayOverrides } = collections(app.mongo.db)
    const admin = await users.findOneAndUpdate(
      { openid: 'dashboard-admin' },
      { $set: { memberStatus: 'approved', isAdmin: true } },
      { returnDocument: 'after' },
    )
    if (!admin) throw new Error('admin missing')
    const memberId = new ObjectId()
    const now = new Date()
    await users.insertOne({
      _id: memberId,
      openid: 'dashboard-member',
      memberStatus: 'approved',
      isAdmin: false,
      createdAt: now,
      updatedAt: now,
    })
    await reservations.insertMany([
      { memberId, date: today, quantity: 2, status: 'active', createdAt: now, updatedAt: now },
      { memberId, date: tomorrow, quantity: 3, status: 'active', createdAt: now, updatedAt: now },
    ])
    await mealDayOverrides.insertMany([
      { date: today, status: 'open', version: 1, updatedBy: admin._id, createdAt: now, updatedAt: now },
      { date: tomorrow, status: 'open', version: 1, updatedBy: admin._id, createdAt: now, updatedAt: now },
    ])
  })

  afterAll(async () => {
    await app.mongo.db.dropDatabase()
    await app.close()
  })

  it('returns both today and tomorrow effective egg totals', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/dashboard/today',
      headers: { authorization: `Bearer ${login.token}` },
    })
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json<AdminTodaySummaryBody>()).toMatchObject({
      date: today,
      status: 'open',
      totalEggs: 2,
      tomorrowDate: tomorrow,
      tomorrowStatus: 'open',
      tomorrowTotalEggs: 3,
    })
  })
})
