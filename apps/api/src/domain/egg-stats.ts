import type { Db, ObjectId } from 'mongodb'
import type { MyEggStatsBody } from '@egg-booking/contracts'
import { collections } from '../db/collections.js'
import { getBillingWeek } from './billing-period.js'
import { getDefaultMealDayStatus, getShanghaiToday } from './business-date.js'

export async function loadMyEggStats(
  db: Db,
  memberId: ObjectId,
  startDate: string,
  now = new Date(),
): Promise<MyEggStatsBody> {
  const throughDate = getShanghaiToday(now)
  const { weekStart } = getBillingWeek(throughDate)
  const effectiveWeekStart = weekStart < startDate ? startDate : weekStart
  if (throughDate < startDate) {
    return { weekStart, throughDate, weekQuantity: 0, totalQuantity: 0 }
  }

  const { reservations, mealDayOverrides } = collections(db)
  const [reservationDocuments, overrides] = await Promise.all([
    reservations
      .find({
        memberId,
        date: { $gte: startDate, $lte: throughDate },
        status: 'active',
        quantity: { $gt: 0 },
      })
      .toArray(),
    mealDayOverrides.find({ date: { $gte: startDate, $lte: throughDate } }).toArray(),
  ])
  const overrideMap = new Map(overrides.map((item) => [item.date, item.status]))
  const effectiveReservations = reservationDocuments.filter(
    (reservation) =>
      (overrideMap.get(reservation.date) ?? getDefaultMealDayStatus(reservation.date)) === 'open',
  )

  return {
    weekStart,
    throughDate,
    weekQuantity: effectiveReservations
      .filter((reservation) => reservation.date >= effectiveWeekStart)
      .reduce((sum, reservation) => sum + reservation.quantity, 0),
    totalQuantity: effectiveReservations.reduce((sum, reservation) => sum + reservation.quantity, 0),
  }
}
