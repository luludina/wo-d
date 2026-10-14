import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { LoginBody, MealDayBatchPreview } from '@egg-booking/contracts'
import { buildApp } from '../src/app.js'
import { collections } from '../src/db/collections.js'
import { formatBusinessDate, getShanghaiToday, parseBusinessDate } from '../src/domain/business-date.js'

const mongoUri = process.env.MONGO_TEST_URI
const integration = mongoUri ? describe : describe.skip
const dbName = `egg_booking_meal_days_test_${Date.now()}`

function upcomingWeekdays(count: number): string[] {
  const start = parseBusinessDate(getShanghaiToday())
  const dates: string[] = []
  for (let offset = 1; dates.length < count; offset += 1) {
    const date = new Date(start.getTime() + offset * 86_400_000)
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) dates.push(formatBusinessDate(date))
  }
  return dates
}

integration('admin meal-day management with MongoDB', () => {
  const app = buildApp({
    mongo: { uri: mongoUri!, dbName },
    auth: {
      exchangeWechatCode: async (code) => ({ openid: `meal-day-${code}` }),
      sessionSecret: 'integration-test-secret',
      sessionTtlDays: 30,
    },
  })
  let admin!: LoginBody

  beforeAll(async () => {
    await app.ready()
    admin = await login('admin')
    await login('member')
    await collections(app.mongo.db).users.updateMany(
      { openid: { $in: ['meal-day-admin', 'meal-day-member'] } },
      { $set: { memberStatus: 'approved' } },
    )
    await collections(app.mongo.db).users.updateOne(
      { openid: 'meal-day-admin' },
      { $set: { isAdmin: true } },
    )
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

  it('cancels reservations, notifies members, and applies idempotently', async () => {
    const [date] = upcomingWeekdays(1)
    const memberDocument = await collections(app.mongo.db).users.findOne({ openid: 'meal-day-member' })
    expect(memberDocument).toBeTruthy()
    await collections(app.mongo.db).reservations.insertOne({
      memberId: memberDocument!._id,
      date: date!,
      quantity: 2,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const authorization = { authorization: `Bearer ${admin.token}` }
    const previewResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/meal-days/batch/preview',
      headers: authorization,
      payload: { from: date, to: date, status: 'closed', reason: '节假日' },
    })
    expect(previewResponse.statusCode).toBe(200)
    const preview = previewResponse.json<MealDayBatchPreview>()
    expect(preview.cancelledReservationCount).toBe(1)
    expect(preview.cancelledEggCount).toBe(2)

    const applyRequest = {
      method: 'POST' as const,
      url: '/api/v1/admin/meal-days/batch/apply',
      headers: { ...authorization, 'idempotency-key': 'meal-day-test-key-1' },
      payload: {
        from: date,
        to: date,
        status: 'closed',
        reason: '节假日',
        previewToken: preview.previewToken,
      },
    }
    const applyResponse = await app.inject(applyRequest)
    expect(applyResponse.statusCode, applyResponse.body).toBe(200)
    expect(applyResponse.json().cancelledReservationCount).toBe(1)

    const reservation = await collections(app.mongo.db).reservations.findOne({ date })
    expect(reservation?.status).toBe('cancelled')
    expect(reservation?.cancelledReason).toBe('meal_day_closed')
    expect(await collections(app.mongo.db).notifications.countDocuments({ relatedDate: date })).toBe(2)

    const retryResponse = await app.inject(applyRequest)
    expect(retryResponse.statusCode).toBe(200)
    expect(await collections(app.mongo.db).notifications.countDocuments({ relatedDate: date })).toBe(2)
    expect(
      await collections(app.mongo.db).auditLogs.countDocuments({ action: 'meal-days.batch.apply' }),
    ).toBe(1)
  })

  it('rejects apply when reservations changed after preview', async () => {
    const [, date] = upcomingWeekdays(2)
    const authorization = { authorization: `Bearer ${admin.token}` }
    const previewResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/meal-days/batch/preview',
      headers: authorization,
      payload: { from: date, to: date, status: 'closed' },
    })
    const preview = previewResponse.json<MealDayBatchPreview>()
    const memberDocument = await collections(app.mongo.db).users.findOne({ openid: 'meal-day-member' })
    expect(memberDocument).toBeTruthy()
    await collections(app.mongo.db).reservations.insertOne({
      memberId: memberDocument!._id,
      date: date!,
      quantity: 1,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const applyResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/meal-days/batch/apply',
      headers: { ...authorization, 'idempotency-key': 'meal-day-test-key-2' },
      payload: { from: date, to: date, status: 'closed', previewToken: preview.previewToken },
    })
    expect(applyResponse.statusCode, applyResponse.body).toBe(409)
    expect(applyResponse.json().code).toBe('MEAL_DAY_PREVIEW_STALE')
  })

  it('keeps explicit overrides and sends one notification per member for a range', async () => {
    const today = parseBusinessDate(getShanghaiToday())
    const from = formatBusinessDate(new Date(today.getTime() + 14 * 86_400_000))
    const to = formatBusinessDate(new Date(today.getTime() + 15 * 86_400_000))
    const dates = [from, to]
    const authorization = { authorization: `Bearer ${admin.token}` }

    const previewResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/meal-days/batch/preview',
      headers: authorization,
      payload: { from, to, status: 'open', reason: '临时供餐' },
    })
    expect(previewResponse.statusCode, previewResponse.body).toBe(200)
    const preview = previewResponse.json<MealDayBatchPreview>()
    expect(preview.changedDateCount).toBe(dates.length)
    expect(preview.changes.every((change) => change.after === 'open')).toBe(true)

    const firstApply = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/meal-days/batch/apply',
      headers: { ...authorization, 'idempotency-key': 'meal-day-range-open-1' },
      payload: {
        from,
        to,
        status: 'open',
        reason: '临时供餐',
        previewToken: preview.previewToken,
      },
    })
    expect(firstApply.statusCode, firstApply.body).toBe(200)

    const overrides = await collections(app.mongo.db).mealDayOverrides
      .find({ date: { $in: dates } })
      .sort({ date: 1 })
      .toArray()
    expect(overrides).toHaveLength(dates.length)
    expect(overrides.every((item) => item.status === 'open' && item.reason === '临时供餐')).toBe(true)

    const rangeContent = `${from} 至 ${to} 已开放鸡蛋预约：临时供餐`
    expect(await collections(app.mongo.db).notifications.countDocuments({ content: rangeContent })).toBe(2)
    expect(await collections(app.mongo.db).notifications.countDocuments({
      content: rangeContent,
      relatedDate: { $exists: true },
    })).toBe(0)

    const secondPreviewResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/meal-days/batch/preview',
      headers: authorization,
      payload: { from, to, status: 'open' },
    })
    const secondPreview = secondPreviewResponse.json<MealDayBatchPreview>()
    const secondApply = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/meal-days/batch/apply',
      headers: { ...authorization, 'idempotency-key': 'meal-day-range-open-2' },
      payload: { from, to, status: 'open', previewToken: secondPreview.previewToken },
    })
    expect(secondApply.statusCode, secondApply.body).toBe(200)

    const repeatedOverrides = await collections(app.mongo.db).mealDayOverrides
      .find({ date: { $in: dates } })
      .toArray()
    expect(repeatedOverrides.every((item) => item.version === 2 && item.reason === undefined)).toBe(true)
    expect(await collections(app.mongo.db).notifications.countDocuments({ type: 'meal_day_opened' })).toBe(4)
  })
})
