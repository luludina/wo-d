import { createHash } from 'node:crypto'
import type { MealDayBatchPreview, MealDayStatus } from '@egg-booking/contracts'
import type { ClientSession, Db, WithId } from 'mongodb'
import { collections } from '../db/collections.js'
import type { MealDayOverrideDocument, ReservationDocument } from '../db/models.js'
import { getDefaultMealDayStatus } from './business-date.js'

export interface MealDaySnapshot {
  overrides: Map<string, WithId<MealDayOverrideDocument>>
  reservations: WithId<ReservationDocument>[]
  token: string
}

export async function loadMealDaySnapshot(
  db: Db,
  dates: string[],
  session?: ClientSession,
): Promise<MealDaySnapshot> {
  const { mealDayOverrides, reservations } = collections(db)
  const [overrideDocuments, reservationDocuments] = await Promise.all([
    mealDayOverrides
      .find({ date: { $in: dates } }, session ? { session } : {})
      .sort({ date: 1 })
      .toArray(),
    reservations
      .find({ date: { $in: dates }, status: 'active' }, session ? { session } : {})
      .sort({ date: 1, memberId: 1 })
      .toArray(),
  ])
  const overrides = new Map(overrideDocuments.map((item) => [item.date, item]))
  const fingerprint = {
    dates: dates.map((date) => {
      const override = overrides.get(date)
      return {
        date,
        effectiveStatus: override?.status ?? getDefaultMealDayStatus(date),
        override: override
          ? { status: override.status, version: override.version, updatedAt: override.updatedAt.toISOString() }
          : null,
      }
    }),
    reservations: reservationDocuments.map((item) => ({
      id: item._id.toHexString(),
      memberId: item.memberId.toHexString(),
      date: item.date,
      quantity: item.quantity,
      updatedAt: item.updatedAt.toISOString(),
    })),
  }

  return {
    overrides,
    reservations: reservationDocuments,
    token: createHash('sha256').update(JSON.stringify(fingerprint)).digest('hex'),
  }
}

export function buildMealDayPreview(
  from: string,
  to: string,
  status: MealDayStatus,
  dates: string[],
  snapshot: MealDaySnapshot,
): MealDayBatchPreview {
  const changes = dates.map((date) => {
    const before = snapshot.overrides.get(date)?.status ?? getDefaultMealDayStatus(date)
    const affected = status === 'closed'
      ? snapshot.reservations.filter((reservation) => reservation.date === date)
      : []
    return {
      date,
      before,
      after: status,
      cancelledReservationCount: affected.length,
      cancelledEggCount: affected.reduce((sum, reservation) => sum + reservation.quantity, 0),
    }
  })
  const closingDates = new Set(
    changes.filter((change) => change.after === 'closed').map((change) => change.date),
  )
  const affectedReservations = snapshot.reservations.filter((reservation) =>
    closingDates.has(reservation.date),
  )

  return {
    from,
    to,
    status,
    changes,
    changedDateCount: changes.length,
    affectedMemberCount: new Set(affectedReservations.map((item) => item.memberId.toHexString())).size,
    cancelledReservationCount: affectedReservations.length,
    cancelledEggCount: affectedReservations.reduce((sum, item) => sum + item.quantity, 0),
    previewToken: snapshot.token,
  }
}
