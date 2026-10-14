import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type {
  LoginBody,
  ReservationBatchResult,
  ReservationCalendarBody,
  ReservationDayDetailsBody,
} from '@egg-booking/contracts'
import { ObjectId } from 'mongodb'
import { buildApp } from '../src/app.js'
import { collections } from '../src/db/collections.js'
import { formatBusinessDate, getShanghaiToday, parseBusinessDate } from '../src/domain/business-date.js'

const mongoUri = process.env.MONGO_TEST_URI
const integration = mongoUri ? describe : describe.skip
const dbName = `egg_booking_reservations_test_${Date.now()}`

function upcomingDate(weekend: boolean): string {
  const today = parseBusinessDate(getShanghaiToday())
  for (let offset = 1; offset < 14; offset += 1) {
    const date = new Date(today.getTime() + offset * 86_400_000)
    const isWeekend = date.getUTCDay() === 0 || date.getUTCDay() === 6
    if (isWeekend === weekend) return formatBusinessDate(date)
  }
  throw new Error('No matching date found')
}

integration('reservation API with MongoDB', () => {
  const app = buildApp({
    mongo: { uri: mongoUri!, dbName },
    auth: {
      exchangeWechatCode: async () => ({ openid: 'reservation-member' }),
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
    await collections(app.mongo.db).users.updateOne(
      { openid: 'reservation-member' },
      { $set: { memberStatus: 'approved', realName: '张三', department: '研发部' } },
    )
  })

  afterAll(async () => {
    await app.mongo.db.dropDatabase()
    await app.close()
  })

  it('saves a single quantity including explicit zero and exposes it in the calendar', async () => {
    const date = upcomingDate(false)
    const headers = { authorization: `Bearer ${login.token}` }
    const saveResponse = await app.inject({
      method: 'PUT',
      url: `/api/v1/reservations/${date}`,
      headers,
      payload: { quantity: 0 },
    })
    expect(saveResponse.statusCode, saveResponse.body).toBe(200)
    expect(saveResponse.json().reservation.quantity).toBe(0)
    expect(saveResponse.json().reservation.status).toBe('active')

    const calendarResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/reservations/calendar?from=${date}&to=${date}`,
      headers,
    })
    expect(calendarResponse.statusCode).toBe(200)
    const calendar = calendarResponse.json<ReservationCalendarBody>()
    expect(calendar.items[0]?.reservation?.quantity).toBe(0)

    const invalidResponse = await app.inject({
      method: 'PUT',
      url: `/api/v1/reservations/${date}`,
      headers,
      payload: { quantity: 6 },
    })
    expect(invalidResponse.statusCode).toBe(400)
  })

  it('applies a batch atomically while skipping closed dates', async () => {
    const weekday = upcomingDate(false)
    const weekend = upcomingDate(true)
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/reservations/batch',
      headers: { authorization: `Bearer ${login.token}` },
      payload: {
        items: [
          { date: weekday, quantity: 3 },
          { date: weekend, quantity: 2 },
        ],
      },
    })
    expect(response.statusCode, response.body).toBe(200)
    const result = response.json<ReservationBatchResult>()
    expect(result.applied.map((item) => item.date)).toContain(weekday)
    expect(result.skippedClosedDates).toEqual([weekend])
    expect(await collections(app.mongo.db).reservations.countDocuments({ date: weekend })).toBe(0)
  })

  it('allows any approved member to view active submissions for one day', async () => {
    const date = upcomingDate(false)
    const approvedMemberId = new ObjectId()
    const draftMemberId = new ObjectId()
    const cancelledMemberId = new ObjectId()
    const now = new Date()

    await collections(app.mongo.db).users.insertMany([
      {
        _id: approvedMemberId,
        openid: 'details-approved-member',
        realName: '李四',
        department: '运营部',
        memberStatus: 'approved',
        isAdmin: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: draftMemberId,
        openid: 'details-draft-member',
        realName: '王五',
        department: '财务部',
        memberStatus: 'draft',
        isAdmin: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: cancelledMemberId,
        openid: 'details-cancelled-member',
        realName: '赵六',
        department: '研发部',
        memberStatus: 'approved',
        isAdmin: false,
        createdAt: now,
        updatedAt: now,
      },
    ])
    await collections(app.mongo.db).reservations.insertMany([
      { memberId: approvedMemberId, date, quantity: 2, status: 'active', createdAt: now, updatedAt: now },
      { memberId: draftMemberId, date, quantity: 4, status: 'active', createdAt: now, updatedAt: now },
      { memberId: cancelledMemberId, date, quantity: 5, status: 'cancelled', createdAt: now, updatedAt: now },
    ])
    await collections(app.mongo.db).reservations.updateOne(
      { memberId: new ObjectId(login.user.id), date },
      {
        $set: { quantity: 0, status: 'active', updatedAt: now },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    )

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/reservations/${date}/details`,
      headers: { authorization: `Bearer ${login.token}` },
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json<ReservationDayDetailsBody>()).toMatchObject({
      date,
      totalEggs: 2,
      filledMemberCount: 2,
      unsubmittedMemberCount: 1,
      items: [
        { nickname: '李四', quantity: 2 },
        { nickname: '张三', quantity: 0 },
      ],
      unsubmittedItems: [
        { nickname: '赵六' },
      ],
    })
  })
})
