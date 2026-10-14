import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsync } from 'fastify'
import { collections } from '../db/collections.js'
import {
  formatBusinessDate,
  getDefaultMealDayStatus,
  getShanghaiToday,
  isReservationLocked,
  parseBusinessDate,
} from '../domain/business-date.js'
import { loadMyEggStats } from '../domain/egg-stats.js'
import { loadLeaderboard } from '../domain/leaderboard.js'

const TodayQuerySchema = Type.Object({}, { additionalProperties: false })
const LeaderboardQuerySchema = Type.Object(
  { period: Type.Union([Type.Literal('week'), Type.Literal('month'), Type.Literal('year')]) },
  { additionalProperties: false },
)

export interface DashboardRoutesOptions {
  billingStartDate: string
}

export const dashboardRoutes: FastifyPluginAsync<DashboardRoutesOptions> = async (app, options) => {
  app.get(
    '/api/v1/dashboard/my-egg-stats',
    {
      schema: { tags: ['dashboard'] },
      preHandler: app.requireMember,
    },
    async (request) =>
      loadMyEggStats(app.mongo.db, request.currentUser!._id, options.billingStartDate),
  )

  app.get<{ Querystring: { period: 'week' | 'month' | 'year' } }>(
    '/api/v1/dashboard/leaderboard',
    {
      schema: { tags: ['dashboard'], querystring: LeaderboardQuerySchema },
      preHandler: app.requireMember,
    },
    async (request) => loadLeaderboard(
      app.mongo.db,
      request.currentUser!._id,
      request.query.period,
    ),
  )

  app.get(
    '/api/v1/admin/dashboard/today',
    {
      schema: { tags: ['admin-dashboard'], querystring: TodayQuerySchema },
      preHandler: app.requireAdmin,
    },
    async () => {
      const date = getShanghaiToday()
      const tomorrowDate = formatBusinessDate(
        new Date(parseBusinessDate(date).getTime() + 86_400_000),
      )
      const dates = [date, tomorrowDate]
      const { users, reservations, mealDayOverrides } = collections(app.mongo.db)
      const [approvedUsers, overrides, reservationDocuments] = await Promise.all([
        users.find({ memberStatus: 'approved' }, { projection: { _id: 1 } }).toArray(),
        mealDayOverrides.find({ date: { $in: dates } }).toArray(),
        reservations.find({ date: { $in: dates } }).toArray(),
      ])
      const approvedIds = new Set(approvedUsers.map((user) => user._id.toHexString()))
      const approvedReservations = reservationDocuments.filter((reservation) =>
        approvedIds.has(reservation.memberId.toHexString()),
      )
      const overrideMap = new Map(overrides.map((item) => [item.date, item.status]))
      const statusOf = (targetDate: string) =>
        overrideMap.get(targetDate) ?? getDefaultMealDayStatus(targetDate)
      const totalOf = (targetDate: string) =>
        statusOf(targetDate) === 'closed'
          ? 0
          : approvedReservations
              .filter(
                (reservation) =>
                  reservation.date === targetDate && reservation.status === 'active',
              )
              .reduce((sum, reservation) => sum + reservation.quantity, 0)
      const todayReservations = approvedReservations.filter(
        (reservation) => reservation.date === date,
      )

      return {
        date,
        status: statusOf(date),
        isLocked: isReservationLocked(date),
        totalEggs: totalOf(date),
        filledMemberCount: todayReservations.length,
        unfilledMemberCount: Math.max(0, approvedUsers.length - todayReservations.length),
        tomorrowDate,
        tomorrowStatus: statusOf(tomorrowDate),
        tomorrowTotalEggs: totalOf(tomorrowDate),
      }
    },
  )
}
