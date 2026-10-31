import { Type, type Static } from '@sinclair/typebox'
import type { FastifyPluginAsync } from 'fastify'
import { ObjectId } from 'mongodb'
import { collections } from '../db/collections.js'
import { getBillingPeriodForDate } from '../domain/billing-period.js'
import { getShanghaiToday, getDefaultMealDayStatus, isReservationLocked } from '../domain/business-date.js'
import { AppError } from '../lib/errors.js'

const DateSchema = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })
const IdSchema = Type.String({ pattern: '^[a-fA-F0-9]{24}$' })
const QuantitySchema = Type.Integer({ minimum: 0, maximum: 5 })
const BodySchema = Type.Object({ quantity: QuantitySchema, reason: Type.Optional(Type.String({ maxLength: 300 })) }, { additionalProperties: false })
const ParamsSchema = Type.Object({ date: DateSchema }, { additionalProperties: false })
const MemberParamsSchema = Type.Object({ date: DateSchema, memberId: IdSchema }, { additionalProperties: false })
const ReviewSchema = Type.Object({ decision: Type.Union([Type.Literal('approve'), Type.Literal('reject')]), quantity: Type.Optional(QuantitySchema), reason: Type.Optional(Type.String({ maxLength: 300 })) }, { additionalProperties: false })
type Body = Static<typeof BodySchema>; type Review = Static<typeof ReviewSchema>

export interface ActualQuantityRoutesOptions { billingStartDate: string }

export const actualQuantityRoutes: FastifyPluginAsync<ActualQuantityRoutesOptions> = async (app, options) => {
  const ensureOpen = async (date: string) => {
    if (!isReservationLocked(date)) throw new AppError(409, 'ACTUAL_QUANTITY_TOO_EARLY', '预约截止前请直接修改预约')
    const override = await collections(app.mongo.db).mealDayOverrides.findOne({ date })
    if ((override?.status ?? getDefaultMealDayStatus(date)) !== 'open') throw new AppError(409, 'MEAL_DAY_CLOSED', '该日期不提供鸡蛋')
    const period = getBillingPeriodForDate(options.billingStartDate, date)
    if (await collections(app.mongo.db).billingRuns.findOne({ weekStart: period.weekStart })) throw new AppError(409, 'BILLING_RUN_EXISTS', '该周账单已生成，不能调整')
  }
  const notify = async (receiverId: ObjectId, title: string, content: string, date: string) => {
    const now = new Date()
    await collections(app.mongo.db).notifications.insertOne({ receiverId, title, content, type: 'actual_quantity', relatedDate: date, isRead: false, createdAt: now, expiresAt: new Date(now.getTime() + 90 * 86400000) })
  }
  app.get('/api/v1/actual-quantities/requests', { preHandler: app.requireMember }, async (request) => {
    const docs = await collections(app.mongo.db).actualQuantityRequests.find({ memberId: request.currentUser!._id }).sort({ createdAt: -1 }).limit(100).toArray()
    return { items: docs }
  })
  app.post<{ Params: Static<typeof ParamsSchema>; Body: Body }>('/api/v1/actual-quantities/:date/request', { schema: { params: ParamsSchema, body: BodySchema }, preHandler: app.requireMember }, async (request) => {
    await ensureOpen(request.params.date); const actor = request.currentUser!; const now = new Date(); const db = collections(app.mongo.db)
    await db.actualQuantityRequests.updateMany({ memberId: actor._id, date: request.params.date, status: 'pending' }, { $set: { status: 'superseded', updatedAt: now } })
    const doc = { _id: new ObjectId(), memberId: actor._id, date: request.params.date, quantity: request.body.quantity, ...(request.body.reason?.trim() ? { reason: request.body.reason.trim() } : {}), status: 'pending' as const, createdAt: now, updatedAt: now }
    await db.actualQuantityRequests.insertOne(doc)
    const admins = await db.users.find({ isAdmin: true, memberStatus: 'approved' }).toArray(); await Promise.all(admins.map((admin) => notify(admin._id, '有新的实际数量申请', `${request.params.date} 有成员申请调整为 ${request.body.quantity} 个`, request.params.date)))
    return doc
  })
  app.get('/api/v1/admin/actual-quantities/requests', { preHandler: app.requireAdmin }, async () => {
    const db = collections(app.mongo.db)
    const requests = await db.actualQuantityRequests.find({}).sort({ createdAt: -1 }).limit(100).toArray()
    if (requests.length === 0) return { items: [] }
    const ids = requests.map((item) => item.memberId)
    const users = await db.users.find({ _id: { $in: ids } }).toArray()
    const reservations = await db.reservations.find({ $or: requests.map((item) => ({ memberId: item.memberId, date: item.date })) }).toArray()
    const userMap = new Map(users.map((user) => [user._id.toHexString(), user]))
    const reservationMap = new Map(reservations.map((item) => [`${item.memberId.toHexString()}:${item.date}`, item]))
    return { items: requests.map((item) => ({ ...item, applicantName: userMap.get(item.memberId.toHexString())?.nickname ?? '成员', applicantAvatarUrl: userMap.get(item.memberId.toHexString())?.avatarUrl, originalQuantity: reservationMap.get(`${item.memberId.toHexString()}:${item.date}`)?.actualQuantity ?? reservationMap.get(`${item.memberId.toHexString()}:${item.date}`)?.quantity ?? 0 })) }
  })
  app.post<{ Params: Static<typeof MemberParamsSchema>; Body: Body }>('/api/v1/admin/actual-quantities/:date/members/:memberId', { schema: { params: MemberParamsSchema, body: BodySchema }, preHandler: app.requireAdmin }, async (request) => {
    await ensureOpen(request.params.date); const memberId = new ObjectId(request.params.memberId); const db = collections(app.mongo.db); const now = new Date()
    const reservation = await db.reservations.findOne({ memberId, date: request.params.date }); const before = reservation?.actualQuantity ?? reservation?.quantity ?? 0
    await db.reservations.updateOne({ memberId, date: request.params.date }, { $set: { actualQuantity: request.body.quantity, updatedAt: now }, $setOnInsert: { memberId, date: request.params.date, quantity: 0, status: 'active', createdAt: now } }, { upsert: true })
    await db.actualQuantityRequests.updateMany({ memberId, date: request.params.date, status: 'pending' }, { $set: { status: 'superseded', updatedAt: now } })
    await db.auditLogs.insertOne({ actorUserId: request.currentUser!._id, action: 'actual_quantity.admin_adjust', targetType: 'reservation', targetId: `${memberId}:${request.params.date}`, before: { quantity: before }, after: { quantity: request.body.quantity }, ...(request.body.reason ? { reason: request.body.reason } : {}), createdAt: now })
    await notify(memberId, '实际吃蛋数量已调整', `${request.params.date} 实际数量为 ${request.body.quantity} 个`, request.params.date)
    return { date: request.params.date, memberId: memberId.toHexString(), quantity: request.body.quantity }
  })
  app.post<{ Params: Static<typeof MemberParamsSchema>; Body: Review }>('/api/v1/admin/actual-quantities/:date/members/:memberId/review', { schema: { params: MemberParamsSchema, body: ReviewSchema }, preHandler: app.requireAdmin }, async (request) => {
    await ensureOpen(request.params.date); const memberId = new ObjectId(request.params.memberId); const db = collections(app.mongo.db); const pending = await db.actualQuantityRequests.findOne({ memberId, date: request.params.date, status: 'pending' }); if (!pending) throw new AppError(404, 'REQUEST_NOT_FOUND', '待审批申请不存在')
    const now = new Date(); const quantity = request.body.quantity ?? pending.quantity; const status = request.body.decision === 'approve' ? 'approved' : 'rejected'; await db.actualQuantityRequests.updateOne({ _id: pending._id }, { $set: { status, reviewedQuantity: quantity, reviewedBy: request.currentUser!._id, ...(request.body.reason ? { reviewReason: request.body.reason } : {}), updatedAt: now } })
    if (status === 'approved') await db.reservations.updateOne({ memberId, date: request.params.date }, { $set: { actualQuantity: quantity, updatedAt: now }, $setOnInsert: { memberId, date: request.params.date, quantity: 0, status: 'active', createdAt: now } }, { upsert: true })
    await notify(memberId, `实际数量申请已${status === 'approved' ? '通过' : '驳回'}`, `${request.params.date} ${status === 'approved' ? `实际数量为 ${quantity} 个` : '申请未通过'}`, request.params.date)
    return { status, quantity }
  })
}
