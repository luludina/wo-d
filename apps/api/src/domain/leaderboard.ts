import type { Db, ObjectId } from 'mongodb'
import type { LeaderboardBody, LeaderboardPeriod } from '@egg-booking/contracts'
import { collections } from '../db/collections.js'
import { formatBusinessDate, getDefaultMealDayStatus, getShanghaiToday, parseBusinessDate } from './business-date.js'
import { getBillingWeek } from './billing-period.js'

function getPeriodRange(period: LeaderboardPeriod, throughDate: string) {
  const date = parseBusinessDate(throughDate)
  if (period === 'week') {
    const { weekStart, weekEnd } = getBillingWeek(throughDate)
    return { periodStart: weekStart, periodEnd: weekEnd }
  }
  if (period === 'month') {
    return {
      periodStart: formatBusinessDate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))),
      periodEnd: formatBusinessDate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0))),
    }
  }
  return {
    periodStart: `${date.getUTCFullYear()}-01-01`,
    periodEnd: `${date.getUTCFullYear()}-12-31`,
  }
}

export async function loadLeaderboard(
  db: Db,
  currentUserId: ObjectId,
  period: LeaderboardPeriod,
  now = new Date(),
): Promise<LeaderboardBody> {
  const throughDate = getShanghaiToday(now)
  const { periodStart, periodEnd } = getPeriodRange(period, throughDate)
  const { users, reservations, mealDayOverrides } = collections(db)
  const [members, reservationDocuments, overrides] = await Promise.all([
    users.find({ memberStatus: 'approved' }).toArray(),
    reservations.find({
      date: { $gte: periodStart, $lte: throughDate },
      status: 'active',
      quantity: { $gt: 0 },
    }).toArray(),
    mealDayOverrides.find({ date: { $gte: periodStart, $lte: throughDate } }).toArray(),
  ])

  const memberIds = new Set(members.map((member) => member._id.toHexString()))
  const overrideMap = new Map(overrides.map((item) => [item.date, item.status]))
  const quantities = new Map<string, number>()
  for (const reservation of reservationDocuments) {
    const memberId = reservation.memberId.toHexString()
    if (!memberIds.has(memberId)) continue
    const mealStatus = overrideMap.get(reservation.date) ?? getDefaultMealDayStatus(reservation.date)
    if (mealStatus !== 'open') continue
    quantities.set(memberId, (quantities.get(memberId) ?? 0) + reservation.quantity)
  }

  const sorted = members
    .map((member) => ({
      memberId: member._id.toHexString(),
      nickname: member.nickname ?? member.realName ?? '成员',
      ...(member.avatarUrl ? { avatarUrl: member.avatarUrl } : {}),
      quantity: quantities.get(member._id.toHexString()) ?? 0,
      isCurrentUser: member._id.equals(currentUserId),
    }))
    .sort((left, right) => right.quantity - left.quantity || left.nickname.localeCompare(right.nickname, 'zh-CN'))

  let previousQuantity: number | undefined
  let previousRank: number | null = null
  const items = sorted.map((item, index) => {
    const rank = item.quantity === 0
      ? null
      : item.quantity === previousQuantity
        ? previousRank
        : index + 1
    previousQuantity = item.quantity
    previousRank = rank
    return { ...item, rank }
  })
  const currentUser = items.find((item) => item.isCurrentUser)

  return {
    period,
    periodStart,
    periodEnd,
    throughDate,
    myRank: currentUser?.rank ?? null,
    myQuantity: currentUser?.quantity ?? 0,
    totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
    items,
  }
}
