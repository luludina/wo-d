import { Type, type Static } from '@sinclair/typebox'
import type { FastifyPluginAsync } from 'fastify'
import { ObjectId } from 'mongodb'
import { collections } from '../db/collections.js'
import type { BillDocument, BillingRunDocument } from '../db/models.js'
import { generateBillDraftForPeriod, publishBillsForPeriod } from '../domain/billing.js'
import { getBillingPeriodForDate } from '../domain/billing-period.js'
import { getShanghaiToday } from '../domain/business-date.js'
import { AppError } from '../lib/errors.js'

const BillParamsSchema = Type.Object(
  { id: Type.String({ pattern: '^[a-fA-F0-9]{24}$' }) },
  { additionalProperties: false },
)
const BillListQuerySchema = Type.Object(
  { limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 50 })) },
  { additionalProperties: false },
)
const AdminBillRunParamsSchema = Type.Object(
  { weekStart: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }) },
  { additionalProperties: false },
)
const AdminBillParamsSchema = Type.Object(
  { id: Type.String({ pattern: '^[a-fA-F0-9]{24}$' }) },
  { additionalProperties: false },
)
const AdminBillAdjustmentSchema = Type.Object(
  {
    totalQuantity: Type.Integer({ minimum: 0, maximum: 100 }),
    reason: Type.String({ minLength: 1, maxLength: 300 }),
  },
  { additionalProperties: false },
)

type AdminBillAdjustmentBody = Static<typeof AdminBillAdjustmentSchema>

export interface BillRoutesOptions {
  billingStartDate: string
}

export const billRoutes: FastifyPluginAsync<BillRoutesOptions> = async (app, options) => {
  app.get<{ Querystring: { limit?: number } }>(
    '/api/v1/admin/bills',
    {
      schema: { tags: ['admin', 'bills'], querystring: BillListQuerySchema },
      preHandler: app.requireAdmin,
    },
    async (request) => {
      const currentPeriod = getBillingPeriodForDate(options.billingStartDate, getShanghaiToday())
      const dbCollections = collections(app.mongo.db)
      const [runs, currentRun, pendingRequests] = await Promise.all([
        dbCollections.billingRuns
          .find()
          .sort({ weekStart: -1 })
          .limit(request.query.limit ?? 50)
          .toArray(),
        dbCollections.billingRuns.findOne({ weekStart: currentPeriod.weekStart }),
        dbCollections.actualQuantityRequests.countDocuments({ status: 'pending', date: { $gte: currentPeriod.reservationFrom, $lte: currentPeriod.weekEnd } }),
      ])
      return {
        currentWeekStart: currentPeriod.weekStart,
        canGenerateCurrentWeek: !currentRun && pendingRequests === 0,
        pendingActualQuantityRequests: pendingRequests,
        items: runs.map(presentAdminBillRun),
      }
    },
  )

  app.post(
    '/api/v1/admin/bills/current/generate',
    {
      schema: { tags: ['admin', 'bills'] },
      preHandler: app.requireAdmin,
    },
    async (request) => {
      const now = new Date()
      const period = getBillingPeriodForDate(options.billingStartDate, getShanghaiToday(now))
      const pending = await collections(app.mongo.db).actualQuantityRequests.countDocuments({ status: 'pending', date: { $gte: period.reservationFrom, $lte: period.weekEnd } })
      if (pending > 0) throw new AppError(409, 'ACTUAL_QUANTITY_REQUESTS_PENDING', '本周存在待审批的实际数量申请，请先处理')
      const result = await generateBillDraftForPeriod(app.mongo.client, app.mongo.db, period, now)
      if (!result.generated) {
        throw new AppError(409, 'BILLING_RUN_EXISTS', '本周账单已经生成')
      }

      await collections(app.mongo.db).auditLogs.insertOne({
        actorUserId: request.currentUser!._id,
        action: 'bills.generate',
        targetType: 'billing_run',
        targetId: period.weekStart,
        after: result,
        requestId: request.id,
        createdAt: now,
      })
      const run = await collections(app.mongo.db).billingRuns.findOne({ weekStart: period.weekStart })
      if (!run) throw new AppError(500, 'BILLING_RUN_MISSING', '账单生成失败')
      return presentAdminBillRun(run)
    },
  )

  app.post<{ Params: { weekStart: string } }>(
    '/api/v1/admin/bills/:weekStart/publish',
    {
      schema: { tags: ['admin', 'bills'], params: AdminBillRunParamsSchema },
      preHandler: app.requireAdmin,
    },
    async (request) => {
      const dbCollections = collections(app.mongo.db)
      const run = await dbCollections.billingRuns.findOne({ weekStart: request.params.weekStart })
      if (!run) throw new AppError(404, 'BILLING_RUN_NOT_FOUND', '账单汇总不存在')
      if (run.status !== 'draft') {
        throw new AppError(409, 'BILL_ALREADY_PUBLISHED', '本周账单已经推送')
      }

      const now = new Date()
      const result = await publishBillsForPeriod(
        app.mongo.client,
        app.mongo.db,
        {
          weekStart: run.weekStart,
          weekEnd: run.weekEnd,
          reservationFrom: run.weekStart,
        },
        now,
      )
      if (!result.published) {
        throw new AppError(409, 'BILL_ALREADY_PUBLISHED', '本周账单已经推送')
      }

      await dbCollections.auditLogs.insertOne({
        actorUserId: request.currentUser!._id,
        action: 'bills.publish',
        targetType: 'billing_run',
        targetId: run.weekStart,
        before: { status: 'draft' },
        after: { status: 'published', ...result },
        requestId: request.id,
        createdAt: now,
      })
      const updated = await dbCollections.billingRuns.findOne({ weekStart: run.weekStart })
      if (!updated) throw new AppError(500, 'BILLING_RUN_MISSING', '账单推送失败')
      return presentAdminBillRun(updated)
    },
  )

  app.get<{ Params: { weekStart: string } }>(
    '/api/v1/admin/bills/:weekStart',
    {
      schema: { tags: ['admin', 'bills'], params: AdminBillRunParamsSchema },
      preHandler: app.requireAdmin,
    },
    async (request) => {
      const dbCollections = collections(app.mongo.db)
      const run = await dbCollections.billingRuns.findOne({ weekStart: request.params.weekStart })
      if (!run) throw new AppError(404, 'BILLING_RUN_NOT_FOUND', '账单汇总不存在')

      const bills = await dbCollections.bills.find({ weekStart: run.weekStart }).toArray()
      const users = bills.length > 0
        ? await dbCollections.users.find({ _id: { $in: bills.map((bill) => bill.memberId) } }).toArray()
        : []
      const userMap = new Map(users.map((user) => [user._id.toHexString(), user]))
      const items = bills
        .map((bill) => {
          const user = userMap.get(bill.memberId.toHexString())
          const effective = effectiveBillTotals(bill)
          return {
            billId: bill._id.toHexString(),
            memberId: bill.memberId.toHexString(),
            realName: user?.realName?.trim() || '未填写姓名',
            ...(user?.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
            ...effective,
            originalTotalQuantity: bill.totalQuantity,
            originalTotalAmountFen: bill.totalAmountFen,
            isAdjusted: bill.adjustedTotalQuantity !== undefined,
            ...(bill.adjustmentReason ? { adjustmentReason: bill.adjustmentReason } : {}),
            ...(bill.adjustedAt ? { adjustedAt: bill.adjustedAt.toISOString() } : {}),
          }
        })
        .sort((left, right) =>
          right.totalAmountFen - left.totalAmountFen || left.realName.localeCompare(right.realName, 'zh-CN'),
        )

      return { ...presentAdminBillRun(run), items }
    },
  )

  app.put<{ Params: { id: string }; Body: AdminBillAdjustmentBody }>(
    '/api/v1/admin/bills/:id/adjustment',
    {
      schema: {
        tags: ['admin', 'bills'],
        params: AdminBillParamsSchema,
        body: AdminBillAdjustmentSchema,
      },
      preHandler: app.requireAdmin,
    },
    async (request) => {
      const actor = request.currentUser!
      const billId = new ObjectId(request.params.id)
      const reason = request.body.reason.trim()
      if (!reason) throw new AppError(400, 'BILL_ADJUSTMENT_REASON_REQUIRED', '请填写调整原因')
      const now = new Date()
      const session = app.mongo.client.startSession()

      try {
        await session.withTransaction(async () => {
          const dbCollections = collections(app.mongo.db)
          const bill = await dbCollections.bills.findOne({ _id: billId }, { session })
          if (!bill) throw new AppError(404, 'BILL_NOT_FOUND', '账单不存在')

          const run = await dbCollections.billingRuns.findOne(
            { weekStart: bill.weekStart },
            { session },
          )
          if (!run) throw new AppError(409, 'BILLING_RUN_MISSING', '账单汇总不存在，无法调整')

          const before = effectiveBillTotals(bill)
          const totalAmountFen = request.body.totalQuantity * bill.unitPriceFen
          if (before.totalQuantity === request.body.totalQuantity) {
            throw new AppError(409, 'BILL_ADJUSTMENT_UNCHANGED', '调整后的数量与当前账单一致')
          }

          await dbCollections.bills.updateOne(
            { _id: bill._id },
            {
              $set: {
                adjustedTotalQuantity: request.body.totalQuantity,
                adjustedTotalAmountFen: totalAmountFen,
                adjustmentReason: reason,
                adjustedBy: actor._id,
                adjustedAt: now,
              },
            },
            { session },
          )
          await dbCollections.billingRuns.updateOne(
            { weekStart: bill.weekStart },
            {
              $inc: {
                totalQuantity: request.body.totalQuantity - before.totalQuantity,
                totalAmountFen: totalAmountFen - before.totalAmountFen,
              },
            },
            { session },
          )

          if (bill.status !== 'draft') {
            await dbCollections.notifications.insertOne(
              {
                receiverId: bill.memberId,
                type: 'bill_adjusted',
                title: '鸡蛋账单已调整',
                content: `本周账单由 ${before.totalQuantity} 个（${formatYuan(before.totalAmountFen)} 元）调整为 ${request.body.totalQuantity} 个（${formatYuan(totalAmountFen)} 元），原因：${reason}`,
                relatedDate: bill.weekStart,
                relatedBillId: bill._id,
                isRead: false,
                createdAt: now,
                expiresAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
              },
              { session },
            )
          }
          await dbCollections.auditLogs.insertOne(
            {
              actorUserId: actor._id,
              action: 'bills.adjust',
              targetType: 'bill',
              targetId: bill._id.toHexString(),
              before,
              after: { totalQuantity: request.body.totalQuantity, totalAmountFen },
              reason,
              requestId: request.id,
              createdAt: now,
            },
            { session },
          )
        })
      } finally {
        await session.endSession()
      }

      const updated = await collections(app.mongo.db).bills.findOne({ _id: billId })
      if (!updated) throw new AppError(404, 'BILL_NOT_FOUND', '账单不存在')
      return presentBillSummary(updated)
    },
  )

  app.get<{ Querystring: { limit?: number } }>(
    '/api/v1/bills',
    {
      schema: { tags: ['bills'], querystring: BillListQuerySchema },
      preHandler: app.requireMember,
    },
    async (request) => {
      const bills = await collections(app.mongo.db).bills
        .find({ memberId: request.currentUser!._id, status: { $ne: 'draft' } })
        .sort({ weekStart: -1 })
        .limit(request.query.limit ?? 50)
        .toArray()
      return { items: bills.map(presentBillSummary) }
    },
  )

  app.get<{ Params: { id: string } }>(
    '/api/v1/bills/:id',
    {
      schema: { tags: ['bills'], params: BillParamsSchema },
      preHandler: app.requireMember,
    },
    async (request) => {
      const bill = await collections(app.mongo.db).bills.findOne({
        _id: new ObjectId(request.params.id),
        memberId: request.currentUser!._id,
        status: { $ne: 'draft' },
      })
      if (!bill) throw new AppError(404, 'BILL_NOT_FOUND', '账单不存在')
      return { ...presentBillSummary(bill), items: bill.items }
    },
  )
}

function presentAdminBillRun(run: BillingRunDocument) {
  const status = run.status === 'draft' ? 'draft' as const : 'published' as const
  return {
    weekStart: run.weekStart,
    weekEnd: run.weekEnd,
    memberCount: run.billCount,
    totalQuantity: run.totalQuantity,
    totalAmountFen: run.totalAmountFen,
    status,
    generatedAt: run.generatedAt.toISOString(),
    ...(status === 'published'
      ? { publishedAt: (run.publishedAt ?? run.generatedAt).toISOString() }
      : {}),
  }
}

function presentBillSummary(bill: BillDocument) {
  const effective = effectiveBillTotals(bill)
  return {
    id: bill._id.toHexString(),
    weekStart: bill.weekStart,
    weekEnd: bill.weekEnd,
    totalQuantity: effective.totalQuantity,
    unitPriceFen: bill.unitPriceFen,
    totalAmountFen: effective.totalAmountFen,
    generatedAt: (bill.publishedAt ?? bill.generatedAt).toISOString(),
    originalTotalQuantity: bill.totalQuantity,
    originalTotalAmountFen: bill.totalAmountFen,
    isAdjusted: bill.adjustedTotalQuantity !== undefined,
    ...(bill.adjustmentReason ? { adjustmentReason: bill.adjustmentReason } : {}),
    ...(bill.adjustedAt ? { adjustedAt: bill.adjustedAt.toISOString() } : {}),
  }
}

function effectiveBillTotals(bill: BillDocument) {
  return {
    totalQuantity: bill.adjustedTotalQuantity ?? bill.totalQuantity,
    totalAmountFen: bill.adjustedTotalAmountFen ?? bill.totalAmountFen,
  }
}

function formatYuan(amountFen: number): string {
  return Number.isInteger(amountFen / 100) ? String(amountFen / 100) : (amountFen / 100).toFixed(2)
}
