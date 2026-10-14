import { Type, type Static } from '@sinclair/typebox'
import type { MealDayBatchPreview, MealDayStatus } from '@egg-booking/contracts'
import type { FastifyPluginAsync } from 'fastify'
import { MongoServerError } from 'mongodb'
import { collections } from '../db/collections.js'
import {
  assertMealDayActionWindow,
  enumerateBusinessDates,
  getDefaultMealDayStatus,
} from '../domain/business-date.js'
import { buildMealDayPreview, loadMealDaySnapshot } from '../domain/meal-days.js'
import { AppError } from '../lib/errors.js'

const MealDayStatusSchema = Type.Union([Type.Literal('open'), Type.Literal('closed')])
const DateSchema = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })

const RangeSchema = Type.Object(
  { from: DateSchema, to: DateSchema },
  { additionalProperties: false },
)

const BatchPreviewSchema = Type.Object(
  {
    from: DateSchema,
    to: DateSchema,
    status: MealDayStatusSchema,
    reason: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })),
  },
  { additionalProperties: false },
)

const BatchApplySchema = Type.Object(
  {
    from: DateSchema,
    to: DateSchema,
    status: MealDayStatusSchema,
    reason: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })),
    previewToken: Type.String({ minLength: 64, maxLength: 64 }),
  },
  { additionalProperties: false },
)

const IdempotencyHeadersSchema = Type.Object(
  { 'idempotency-key': Type.String({ minLength: 8, maxLength: 100 }) },
  { additionalProperties: true },
)

type RangeQuery = Static<typeof RangeSchema>
type BatchPreviewBody = Static<typeof BatchPreviewSchema>
type BatchApplyBody = Static<typeof BatchApplySchema>
type IdempotencyHeaders = Static<typeof IdempotencyHeadersSchema>

const actionName = 'meal-days.batch.apply'

export const adminMealDayRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: RangeQuery }>(
    '/api/v1/admin/meal-days',
    {
      schema: { tags: ['admin'], querystring: RangeSchema },
      preHandler: app.requireAdmin,
    },
    async (request) => {
      const dates = enumerateBusinessDates(request.query.from, request.query.to)
      const overrides = await collections(app.mongo.db).mealDayOverrides
        .find({ date: { $in: dates } })
        .toArray()
      const overrideMap = new Map(overrides.map((item) => [item.date, item]))
      return {
        items: dates.map((date) => {
          const override = overrideMap.get(date)
          return {
            date,
            status: override?.status ?? getDefaultMealDayStatus(date),
            source: override ? 'override' as const : 'default' as const,
            ...(override?.reason ? { reason: override.reason } : {}),
            ...(override ? { version: override.version } : {}),
          }
        }),
      }
    },
  )

  app.post<{ Body: BatchPreviewBody }>(
    '/api/v1/admin/meal-days/batch/preview',
    {
      schema: { tags: ['admin'], body: BatchPreviewSchema },
      preHandler: app.requireAdmin,
    },
    async (request) => {
      const dates = assertMealDayActionWindow(
        request.body.from,
        request.body.to,
        request.body.status,
      )
      const snapshot = await loadMealDaySnapshot(app.mongo.db, dates)
      return buildMealDayPreview(
        request.body.from,
        request.body.to,
        request.body.status,
        dates,
        snapshot,
      )
    },
  )

  app.post<{ Body: BatchApplyBody; Headers: IdempotencyHeaders }>(
    '/api/v1/admin/meal-days/batch/apply',
    {
      schema: { tags: ['admin'], body: BatchApplySchema, headers: IdempotencyHeadersSchema },
      preHandler: app.requireAdmin,
    },
    async (request) => {
      const actor = request.currentUser!
      const key = request.headers['idempotency-key']
      const { idempotencyKeys } = collections(app.mongo.db)
      const existing = await idempotencyKeys.findOne({ actorUserId: actor._id, action: actionName, key })
      if (existing) return existing.response

      const dates = assertMealDayActionWindow(
        request.body.from,
        request.body.to,
        request.body.status,
      )
      const mongoSession = app.mongo.client.startSession()
      let response: MealDayBatchPreview | null = null

      try {
        await mongoSession.withTransaction(async () => {
          const dbCollections = collections(app.mongo.db)
          const duplicate = await dbCollections.idempotencyKeys.findOne(
            { actorUserId: actor._id, action: actionName, key },
            { session: mongoSession },
          )
          if (duplicate) {
            response = duplicate.response as MealDayBatchPreview
            return
          }

          const snapshot = await loadMealDaySnapshot(app.mongo.db, dates, mongoSession)
          if (snapshot.token !== request.body.previewToken) {
            throw new AppError(409, 'MEAL_DAY_PREVIEW_STALE', '供餐日或预约已变化，请重新预览')
          }
          const preview = buildMealDayPreview(
            request.body.from,
            request.body.to,
            request.body.status,
            dates,
            snapshot,
          )
          const now = new Date()
          const reason = request.body.reason?.trim()

          for (const date of dates) {
            const set = {
              status: request.body.status,
              updatedBy: actor._id,
              updatedAt: now,
              ...(reason ? { reason } : {}),
            }
            await dbCollections.mealDayOverrides.updateOne(
              { date },
              {
                $set: set,
                ...(!reason ? { $unset: { reason: '' } } : {}),
                $setOnInsert: { createdAt: now },
                $inc: { version: 1 },
              },
              { upsert: true, session: mongoSession },
            )
          }

          const closingDates = preview.changes
            .filter((change) => change.after === 'closed')
            .map((change) => change.date)
          if (closingDates.length > 0) {
            await dbCollections.reservations.updateMany(
              { date: { $in: closingDates }, status: 'active' },
              {
                $set: {
                  status: 'cancelled',
                  cancelledReason: 'meal_day_closed',
                  updatedAt: now,
                },
              },
              { session: mongoSession },
            )
          }

          const approvedMembers = preview.changes.length > 0
            ? await dbCollections.users
                .find({ memberStatus: 'approved' }, { session: mongoSession, projection: { _id: 1 } })
                .toArray()
            : []
          const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
          const rangeLabel = request.body.from === request.body.to
            ? request.body.from
            : `${request.body.from} 至 ${request.body.to}`
          const notificationType = request.body.status === 'open'
            ? 'meal_day_opened'
            : 'meal_day_closed'
          const notificationTitle = request.body.status === 'open'
            ? '供餐日已开放'
            : '供餐日已关闭'
          const notifications = approvedMembers.map((member) => ({
            receiverId: member._id,
            type: notificationType,
            title: notificationTitle,
            content: `${rangeLabel} ${request.body.status === 'open' ? '已开放鸡蛋预约' : '已停止供应鸡蛋'}${reason ? `：${reason}` : ''}`,
            ...(request.body.from === request.body.to ? { relatedDate: request.body.from } : {}),
            isRead: false,
            createdAt: now,
            expiresAt,
          }))
          if (notifications.length > 0) {
            await dbCollections.notifications.insertMany(notifications, { session: mongoSession })
          }

          await dbCollections.auditLogs.insertOne(
            {
              actorUserId: actor._id,
              action: actionName,
              targetType: 'meal_day_range',
              targetId: `${request.body.from}:${request.body.to}`,
              before: preview.changes.map((change) => ({ date: change.date, status: change.before })),
              after: preview.changes.map((change) => ({ date: change.date, status: change.after })),
              ...(reason ? { reason } : {}),
              requestId: request.id,
              createdAt: now,
            },
            { session: mongoSession },
          )

          response = preview
          await dbCollections.idempotencyKeys.insertOne(
            {
              actorUserId: actor._id,
              action: actionName,
              key,
              response: preview,
              createdAt: now,
              expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
            },
            { session: mongoSession },
          )
        })
      } catch (error) {
        if (error instanceof MongoServerError && error.code === 11000) {
          const duplicate = await idempotencyKeys.findOne({
            actorUserId: actor._id,
            action: actionName,
            key,
          })
          if (duplicate) response = duplicate.response as MealDayBatchPreview
          else throw error
        } else {
          throw error
        }
      } finally {
        await mongoSession.endSession()
      }

      if (!response) throw new Error('Meal-day transaction produced no response')
      return response
    },
  )
}
