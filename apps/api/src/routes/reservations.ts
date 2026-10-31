import { Type, type Static } from '@sinclair/typebox'
import type { FastifyPluginAsync } from 'fastify'
import type { ObjectId } from 'mongodb'
import { collections } from '../db/collections.js'
import {
  assertReservationQueryWindow,
  assertReservationDateInWindow,
  assertReservationWriteDate,
  enumerateBusinessDates,
  getDefaultMealDayStatus,
  isReservationLocked,
} from '../domain/business-date.js'
import { AppError } from '../lib/errors.js'

const DateSchema = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })
const QuantitySchema = Type.Integer({ minimum: 0, maximum: 5 })
const CalendarQuerySchema = Type.Object(
  { from: DateSchema, to: DateSchema },
  { additionalProperties: false },
)
const ReservationParamsSchema = Type.Object({ date: DateSchema }, { additionalProperties: false })
const ReservationBodySchema = Type.Object({ quantity: QuantitySchema }, { additionalProperties: false })
const BatchBodySchema = Type.Object(
  {
    items: Type.Array(
      Type.Object({ date: DateSchema, quantity: QuantitySchema }, { additionalProperties: false }),
      { minItems: 1, maxItems: 62 },
    ),
  },
  { additionalProperties: false },
)

type CalendarQuery = Static<typeof CalendarQuerySchema>
type ReservationParams = Static<typeof ReservationParamsSchema>
type ReservationBody = Static<typeof ReservationBodySchema>
type BatchBody = Static<typeof BatchBodySchema>

export const reservationRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: CalendarQuery }>(
    '/api/v1/reservations/calendar',
    {
      schema: { tags: ['reservations'], querystring: CalendarQuerySchema },
      preHandler: app.requireMember,
    },
    async (request) => {
      const dates = assertReservationQueryWindow(request.query.from, request.query.to)
      return { items: await buildCalendar(request.currentUser!._id, dates) }
    },
  )

  app.get<{ Params: ReservationParams }>(
    '/api/v1/reservations/:date/details',
    {
      schema: { tags: ['reservations'], params: ReservationParamsSchema },
      preHandler: app.requireMember,
    },
    async (request) => {
      enumerateBusinessDates(request.params.date, request.params.date)
      const { reservations, users } = collections(app.mongo.db)
      const dateValue = new Date(`${request.params.date}T00:00:00Z`)
      const monday = new Date(dateValue)
      const weekday = monday.getUTCDay() || 7
      monday.setUTCDate(monday.getUTCDate() - weekday + 1)
      const weekStart = monday.toISOString().slice(0, 10)
      const [reservationDocuments, members] = await Promise.all([
        reservations.find({ date: request.params.date, status: 'active' }).toArray(),
        users.find({ memberStatus: 'approved' }).toArray(),
      ])
      const billingGenerated = Boolean(await collections(app.mongo.db).billingRuns.findOne({ weekStart }))
      const reservationMap = new Map(
        reservationDocuments.map((reservation) => [reservation.memberId.toHexString(), reservation]),
      )
      const memberView = (member: (typeof members)[number]) => ({
        memberId: member._id.toHexString(),
        nickname: member.nickname ?? member.realName ?? '成员',
        ...(member.avatarUrl ? { avatarUrl: member.avatarUrl } : {}),
      })
      const items = members
        .flatMap((member) => {
          const reservation = reservationMap.get(member._id.toHexString())
          return reservation ? [{ ...memberView(member), quantity: reservation.actualQuantity ?? reservation.quantity, reservedQuantity: reservation.quantity, isAdjusted: reservation.actualQuantity !== undefined }] : []
        })
        .sort((left, right) => right.quantity - left.quantity || left.nickname.localeCompare(right.nickname, 'zh-CN'))
      const unsubmittedItems = members
        .filter((member) => !reservationMap.has(member._id.toHexString()))
        .map(memberView)
        .sort((left, right) => left.nickname.localeCompare(right.nickname, 'zh-CN'))

      return {
        date: request.params.date,
        totalEggs: items.reduce((sum, item) => sum + item.quantity, 0),
        filledMemberCount: items.length,
        unsubmittedMemberCount: unsubmittedItems.length,
        billingGenerated,
        items,
        unsubmittedItems,
      }
    },
  )

  app.put<{ Params: ReservationParams; Body: ReservationBody }>(
    '/api/v1/reservations/:date',
    {
      schema: { tags: ['reservations'], params: ReservationParamsSchema, body: ReservationBodySchema },
      preHandler: app.requireMember,
    },
    async (request) => {
      const now = new Date()
      assertReservationWriteDate(request.params.date, now)
      const mealStatus = await getMealStatus(request.params.date)
      if (mealStatus === 'closed') {
        throw new AppError(409, 'MEAL_DAY_CLOSED', '该日期不提供鸡蛋')
      }

      await collections(app.mongo.db).reservations.updateOne(
        { memberId: request.currentUser!._id, date: request.params.date },
        {
          $set: {
            quantity: request.body.quantity,
            status: 'active',
            updatedAt: now,
          },
          $setOnInsert: { createdAt: now },
          $unset: { cancelledReason: '' },
        },
        { upsert: true },
      )
      const [item] = await buildCalendar(request.currentUser!._id, [request.params.date], now)
      return item
    },
  )

  app.post<{ Body: BatchBody }>(
    '/api/v1/reservations/batch',
    {
      schema: { tags: ['reservations'], body: BatchBodySchema },
      preHandler: app.requireMember,
    },
    async (request) => {
      const uniqueItems = new Map<string, number>()
      const now = new Date()
      for (const item of request.body.items) {
        if (uniqueItems.has(item.date)) {
          throw new AppError(400, 'RESERVATION_DATE_DUPLICATED', '批量预约中存在重复日期')
        }
        assertReservationDateInWindow(item.date, now)
        uniqueItems.set(item.date, item.quantity)
      }
      const dates = [...uniqueItems.keys()]
      const sortedDates = [...dates].sort()
      enumerateBusinessDates(sortedDates[0]!, sortedDates[sortedDates.length - 1]!)

      const mongoSession = app.mongo.client.startSession()
      const skippedClosedDates: string[] = []
      const skippedLockedDates = dates.filter((date) => isReservationLocked(date, now))
      const writableDates = dates.filter((date) => !skippedLockedDates.includes(date))
      try {
        await mongoSession.withTransaction(async () => {
          const { mealDayOverrides, reservations } = collections(app.mongo.db)
          const overrides = await mealDayOverrides
            .find({ date: { $in: writableDates } }, { session: mongoSession })
            .toArray()
          const overrideMap = new Map(overrides.map((item) => [item.date, item.status]))

          for (const date of writableDates) {
            const quantity = uniqueItems.get(date)!
            const mealStatus = overrideMap.get(date) ?? getDefaultMealDayStatus(date)
            if (mealStatus === 'closed') {
              skippedClosedDates.push(date)
              continue
            }
            await reservations.updateOne(
              { memberId: request.currentUser!._id, date },
              {
                $set: { quantity, status: 'active', updatedAt: now },
                $setOnInsert: { createdAt: now },
                $unset: { cancelledReason: '' },
              },
              { upsert: true, session: mongoSession },
            )
          }
        })
      } finally {
        await mongoSession.endSession()
      }

      const appliedDates = writableDates.filter((date) => !skippedClosedDates.includes(date))
      return {
        applied: await buildCalendar(request.currentUser!._id, appliedDates),
        skippedClosedDates,
        skippedLockedDates,
      }
    },
  )

  async function getMealStatus(date: string) {
    const override = await collections(app.mongo.db).mealDayOverrides.findOne({ date })
    return override?.status ?? getDefaultMealDayStatus(date)
  }

  async function buildCalendar(memberId: ObjectId, dates: string[], now = new Date()) {
    const { mealDayOverrides, reservations } = collections(app.mongo.db)
    const [overrides, reservationDocuments] = await Promise.all([
      mealDayOverrides.find({ date: { $in: dates } }).toArray(),
      reservations.find({ memberId, date: { $in: dates } }).toArray(),
    ])
    const overrideMap = new Map(overrides.map((item) => [item.date, item]))
    const reservationMap = new Map(reservationDocuments.map((item) => [item.date, item]))
    return dates.map((date) => {
      const override = overrideMap.get(date)
      const reservation = reservationMap.get(date)
      return {
        date,
        isLocked: isReservationLocked(date, now),
        status: override?.status ?? getDefaultMealDayStatus(date),
        source: override ? 'override' as const : 'default' as const,
        ...(override?.reason ? { reason: override.reason } : {}),
        ...(override ? { version: override.version } : {}),
        reservation: reservation
          ? {
              quantity: reservation.actualQuantity ?? reservation.quantity,
              reservedQuantity: reservation.quantity,
              isAdjusted: reservation.actualQuantity !== undefined,
              status: reservation.status,
              isLocked: isReservationLocked(date, now),
              ...(reservation.cancelledReason ? { cancelledReason: reservation.cancelledReason } : {}),
            }
          : null,
      }
    })
  }
}
