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
import { generateDueBillDrafts, publishDueBills } from '../src/domain/billing.js'
import { getBillingPeriodForDate } from '../src/domain/billing-period.js'
import { getShanghaiToday } from '../src/domain/business-date.js'

const mongoUri = process.env.MONGO_TEST_URI
const integration = mongoUri ? describe : describe.skip
const dbName = `egg_booking_billing_test_${Date.now()}`

integration('two-stage weekly billing with MongoDB', () => {
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
      { $set: { memberStatus: 'approved', nickname: '微信昵称甲', realName: '张三' } },
      { returnDocument: 'after' },
    )
    if (!user) throw new Error('test user missing')
    const now = new Date('2026-10-09T17:00:00+08:00')
    const secondMemberId = new ObjectId()
    await users.insertOne({
      _id: secondMemberId,
      openid: 'billing-member-2',
      nickname: '微信昵称乙',
      realName: '李四',
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

  it('drafts at 17:00, accepts admin adjustments, and publishes personal bills at 18:00', async () => {
    const draftAt = new Date('2026-10-09T17:00:00+08:00')
    const publishAt = new Date('2026-10-09T18:00:00+08:00')
    const dbCollections = collections(app.mongo.db)

    const draftRun = await generateDueBillDrafts(app.mongo.client, app.mongo.db, '2026-10-09', draftAt)
    expect(draftRun).toEqual([
      {
        weekStart: '2026-10-05',
        weekEnd: '2026-10-09',
        generated: true,
        billCount: 2,
        totalQuantity: 5,
        totalAmountFen: 500,
      },
    ])
    expect((await generateDueBillDrafts(app.mongo.client, app.mongo.db, '2026-10-09', draftAt))[0]?.generated).toBe(false)
    expect(await publishDueBills(app.mongo.client, app.mongo.db, '2026-10-09', draftAt)).toEqual([])
    expect(await dbCollections.bills.countDocuments({ status: 'draft' })).toBe(2)
    expect(await dbCollections.notifications.countDocuments({ type: 'bill_generated' })).toBe(0)

    const headers = { authorization: `Bearer ${login.token}` }
    const hiddenDraftList = await app.inject({ method: 'GET', url: '/api/v1/bills', headers })
    expect(hiddenDraftList.statusCode, hiddenDraftList.body).toBe(200)
    expect(hiddenDraftList.json<BillListBody>().items).toEqual([])

    const draftBill = await dbCollections.bills.findOne({ weekStart: '2026-10-05' })
    expect(draftBill).toBeTruthy()
    const nonAdminAdjustment = await app.inject({
      method: 'PUT',
      url: `/api/v1/admin/bills/${draftBill!._id.toHexString()}/adjustment`,
      headers,
      payload: { totalQuantity: 4, reason: '不应被允许' },
    })
    expect(nonAdminAdjustment.statusCode, nonAdminAdjustment.body).toBe(403)
    const nonAdminGeneration = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/bills/current/generate',
      headers,
    })
    expect(nonAdminGeneration.statusCode, nonAdminGeneration.body).toBe(403)

    await dbCollections.users.updateOne(
      { openid: 'billing-member' },
      { $set: { isAdmin: true } },
    )
    const adminListResponse = await app.inject({ method: 'GET', url: '/api/v1/admin/bills', headers })
    expect(adminListResponse.statusCode, adminListResponse.body).toBe(200)
    expect(adminListResponse.json<AdminBillRunListBody>().items).toEqual([
      expect.objectContaining({
        weekStart: '2026-10-05',
        status: 'draft',
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
    expect(adminDetail.status).toBe('draft')
    expect(adminDetail.items).toEqual([
      expect.objectContaining({ realName: '李四', totalQuantity: 3, totalAmountFen: 300 }),
      expect.objectContaining({ realName: '张三', totalQuantity: 2, totalAmountFen: 200 }),
    ])
    expect(adminDetail.items[0]).not.toHaveProperty('nickname')

    const zhangBill = adminDetail.items.find((item) => item.realName === '张三')
    expect(zhangBill).toBeTruthy()
    const adjustmentResponse = await app.inject({
      method: 'PUT',
      url: `/api/v1/admin/bills/${zhangBill!.billId}/adjustment`,
      headers,
      payload: { totalQuantity: 4, reason: '线下确认补记' },
    })
    expect(adjustmentResponse.statusCode, adjustmentResponse.body).toBe(200)
    expect(adjustmentResponse.json()).toMatchObject({
      totalQuantity: 4,
      totalAmountFen: 400,
      originalTotalQuantity: 2,
      isAdjusted: true,
    })
    expect(await dbCollections.notifications.countDocuments({ type: 'bill_adjusted' })).toBe(0)
    expect(await dbCollections.billingRuns.findOne({ weekStart: '2026-10-05' })).toMatchObject({
      status: 'draft',
      totalQuantity: 7,
      totalAmountFen: 700,
    })

    const publishRun = await publishDueBills(app.mongo.client, app.mongo.db, '2026-10-09', publishAt)
    expect(publishRun).toEqual([
      {
        weekStart: '2026-10-05',
        weekEnd: '2026-10-09',
        published: true,
        billCount: 2,
        totalQuantity: 7,
        totalAmountFen: 700,
      },
    ])
    expect((await publishDueBills(app.mongo.client, app.mongo.db, '2026-10-09', publishAt))[0]?.published).toBe(false)
    expect(await dbCollections.bills.countDocuments({ status: 'published' })).toBe(2)

    const personalListResponse = await app.inject({ method: 'GET', url: '/api/v1/bills', headers })
    expect(personalListResponse.statusCode, personalListResponse.body).toBe(200)
    const personalList = personalListResponse.json<BillListBody>()
    expect(personalList.items).toHaveLength(1)
    expect(personalList.items[0]).toMatchObject({
      totalQuantity: 4,
      totalAmountFen: 400,
      generatedAt: publishAt.toISOString(),
      isAdjusted: true,
    })

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/bills/${personalList.items[0]!.id}`,
      headers,
    })
    expect(detailResponse.statusCode, detailResponse.body).toBe(200)
    expect(detailResponse.json<BillDetail>().items).toEqual([{ date: '2026-10-09', quantity: 2 }])

    const notificationResponse = await app.inject({ method: 'GET', url: '/api/v1/notifications', headers })
    const notifications = notificationResponse.json<NotificationListBody>()
    expect(notifications.items[0]).toMatchObject({
      type: 'bill_generated',
      content: '本周鸡蛋账单共 4 个，合计 4 元（管理员已调整：线下确认补记）',
      relatedBillId: personalList.items[0]!.id,
      isRead: false,
    })

    const publishedAdminList = await app.inject({ method: 'GET', url: '/api/v1/admin/bills', headers })
    expect(publishedAdminList.json<AdminBillRunListBody>().items[0]).toMatchObject({
      status: 'published',
      totalQuantity: 7,
      totalAmountFen: 700,
    })

    const blankReasonResponse = await app.inject({
      method: 'PUT',
      url: `/api/v1/admin/bills/${zhangBill!.billId}/adjustment`,
      headers,
      payload: { totalQuantity: 1, reason: '   ' },
    })
    expect(blankReasonResponse.statusCode, blankReasonResponse.body).toBe(400)

    const publishedAdjustment = await app.inject({
      method: 'PUT',
      url: `/api/v1/admin/bills/${zhangBill!.billId}/adjustment`,
      headers,
      payload: { totalQuantity: 0, reason: '本周实际未取蛋' },
    })
    expect(publishedAdjustment.statusCode, publishedAdjustment.body).toBe(200)
    expect(publishedAdjustment.json()).toMatchObject({ totalQuantity: 0, totalAmountFen: 0, isAdjusted: true })
    expect(await dbCollections.billingRuns.findOne({ weekStart: '2026-10-05' })).toMatchObject({
      status: 'published',
      billCount: 2,
      totalQuantity: 3,
      totalAmountFen: 300,
    })
    expect(await dbCollections.bills.countDocuments()).toBe(2)
    expect(await dbCollections.auditLogs.countDocuments({ action: 'bills.adjust' })).toBe(2)
    expect(await dbCollections.notifications.countDocuments({
      type: 'bill_adjusted',
      receiverId: new ObjectId(zhangBill!.memberId),
    })).toBe(1)

    const invalidWeekResponse = await app.inject({ method: 'GET', url: '/api/v1/admin/bills/not-a-date', headers })
    expect(invalidWeekResponse.statusCode, invalidWeekResponse.body).toBe(400)
    const missingWeekResponse = await app.inject({ method: 'GET', url: '/api/v1/admin/bills/2026-09-28', headers })
    expect(missingWeekResponse.statusCode, missingWeekResponse.body).toBe(404)

    const currentPeriod = getBillingPeriodForDate('2026-10-09', getShanghaiToday())
    const currentUser = await dbCollections.users.findOne({ openid: 'billing-member' })
    if (!currentUser) throw new Error('current test user missing')
    await dbCollections.reservations.insertOne({
      memberId: currentUser._id,
      date: currentPeriod.weekStart,
      quantity: 2,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const beforeManualList = await app.inject({ method: 'GET', url: '/api/v1/admin/bills', headers })
    expect(beforeManualList.json<AdminBillRunListBody>()).toMatchObject({
      currentWeekStart: currentPeriod.weekStart,
      canGenerateCurrentWeek: true,
    })
    const manualGeneration = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/bills/current/generate',
      headers,
    })
    expect(manualGeneration.statusCode, manualGeneration.body).toBe(200)
    expect(manualGeneration.json()).toMatchObject({
      weekStart: currentPeriod.weekStart,
      status: 'draft',
      memberCount: 1,
      totalAmountFen: 200,
    })
    const duplicateGeneration = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/bills/current/generate',
      headers,
    })
    expect(duplicateGeneration.statusCode, duplicateGeneration.body).toBe(409)

    const currentDetailResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/bills/${currentPeriod.weekStart}`,
      headers,
    })
    const currentDetail = currentDetailResponse.json<AdminBillRunDetail>()
    expect(currentDetail.items).toEqual([
      expect.objectContaining({ realName: '张三', totalQuantity: 2, totalAmountFen: 200 }),
    ])

    const generatedNotificationCount = await dbCollections.notifications.countDocuments({ type: 'bill_generated' })
    const manualPublish = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/bills/${currentPeriod.weekStart}/publish`,
      headers,
    })
    expect(manualPublish.statusCode, manualPublish.body).toBe(200)
    expect(manualPublish.json()).toMatchObject({ status: 'published' })
    expect(await dbCollections.notifications.countDocuments({ type: 'bill_generated' })).toBe(
      generatedNotificationCount + 1,
    )
    const duplicatePublish = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/bills/${currentPeriod.weekStart}/publish`,
      headers,
    })
    expect(duplicatePublish.statusCode, duplicatePublish.body).toBe(409)

    const notificationCountBeforeScheduler = await dbCollections.notifications.countDocuments({ type: 'bill_generated' })
    const scheduledResults = await publishDueBills(
      app.mongo.client,
      app.mongo.db,
      '2026-10-09',
      new Date(`${currentPeriod.weekEnd}T18:00:00+08:00`),
    )
    expect(scheduledResults.find((item) => item.weekStart === currentPeriod.weekStart)?.published).toBe(false)
    expect(await dbCollections.notifications.countDocuments({ type: 'bill_generated' })).toBe(
      notificationCountBeforeScheduler,
    )
    expect(await dbCollections.auditLogs.countDocuments({ action: 'bills.generate' })).toBe(1)
    expect(await dbCollections.auditLogs.countDocuments({ action: 'bills.publish' })).toBe(1)
  })
})
