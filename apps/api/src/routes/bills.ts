import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsync } from 'fastify'
import { ObjectId } from 'mongodb'
import { collections } from '../db/collections.js'
import type { BillDocument, BillingRunDocument } from '../db/models.js'
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

export const billRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { limit?: number } }>(
    '/api/v1/admin/bills',
    {
      schema: { tags: ['admin', 'bills'], querystring: BillListQuerySchema },
      preHandler: app.requireAdmin,
    },
    async (request) => {
      const runs = await collections(app.mongo.db).billingRuns
        .find()
        .sort({ weekStart: -1 })
        .limit(request.query.limit ?? 50)
        .toArray()
      return { items: runs.map(presentAdminBillRun) }
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
          return {
            memberId: bill.memberId.toHexString(),
            nickname: user?.nickname?.trim() || user?.realName?.trim() || '成员',
            ...(user?.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
            totalQuantity: bill.totalQuantity,
            totalAmountFen: bill.totalAmountFen,
          }
        })
        .sort((left, right) =>
          right.totalAmountFen - left.totalAmountFen || left.nickname.localeCompare(right.nickname, 'zh-CN'),
        )

      return { ...presentAdminBillRun(run), items }
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
        .find({ memberId: request.currentUser!._id })
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
      })
      if (!bill) throw new AppError(404, 'BILL_NOT_FOUND', '账单不存在')
      return { ...presentBillSummary(bill), items: bill.items }
    },
  )
}

function presentAdminBillRun(run: BillingRunDocument) {
  return {
    weekStart: run.weekStart,
    weekEnd: run.weekEnd,
    memberCount: run.billCount,
    totalQuantity: run.totalQuantity,
    totalAmountFen: run.totalAmountFen,
    generatedAt: run.generatedAt.toISOString(),
  }
}

function presentBillSummary(bill: BillDocument) {
  return {
    id: bill._id.toHexString(),
    weekStart: bill.weekStart,
    weekEnd: bill.weekEnd,
    totalQuantity: bill.totalQuantity,
    unitPriceFen: bill.unitPriceFen,
    totalAmountFen: bill.totalAmountFen,
    generatedAt: bill.generatedAt.toISOString(),
  }
}
