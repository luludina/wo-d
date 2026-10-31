import type { Db, MongoClient, ObjectId } from 'mongodb'
import { MongoServerError, ObjectId as MongoObjectId } from 'mongodb'
import { collections } from '../db/collections.js'
import type { BillDocument } from '../db/models.js'
import { enumerateBusinessDates, getDefaultMealDayStatus } from './business-date.js'
import { enumerateDueBillingPeriods, type BillingPeriod } from './billing-period.js'

export const EGG_UNIT_PRICE_FEN = 100

export interface BillingGenerationResult {
  weekStart: string
  weekEnd: string
  generated: boolean
  billCount: number
  totalQuantity: number
  totalAmountFen: number
}

export interface BillingPublishResult {
  weekStart: string
  weekEnd: string
  published: boolean
  billCount: number
  totalQuantity: number
  totalAmountFen: number
}

export async function generateDueBillDrafts(
  client: MongoClient,
  db: Db,
  billingStartDate: string,
  now = new Date(),
): Promise<BillingGenerationResult[]> {
  const periods = enumerateDueBillingPeriods(billingStartDate, now, '17:00')
  const results: BillingGenerationResult[] = []
  for (const period of periods) {
    results.push(await generateBillDraftForPeriod(client, db, period, now))
  }
  return results
}

export async function publishDueBills(
  client: MongoClient,
  db: Db,
  billingStartDate: string,
  now = new Date(),
): Promise<BillingPublishResult[]> {
  const periods = enumerateDueBillingPeriods(billingStartDate, now, '18:00')
  const results: BillingPublishResult[] = []
  for (const period of periods) {
    results.push(await publishBillsForPeriod(client, db, period, now))
  }
  return results
}

export async function generateBillDraftForPeriod(
  client: MongoClient,
  db: Db,
  period: BillingPeriod,
  generatedAt = new Date(),
): Promise<BillingGenerationResult> {
  const existingRun = await collections(db).billingRuns.findOne({ weekStart: period.weekStart })
  if (existingRun) return presentExistingRun(existingRun)

  const session = client.startSession()
  let result: BillingGenerationResult | null = null
  try {
    await session.withTransaction(async () => {
      const dbCollections = collections(db)
      const duplicateRun = await dbCollections.billingRuns.findOne(
        { weekStart: period.weekStart },
        { session },
      )
      if (duplicateRun) {
        result = presentExistingRun(duplicateRun)
        return
      }

      const reservations = await dbCollections.reservations
        .find(
          {
            date: { $gte: period.reservationFrom, $lte: period.weekEnd },
            status: 'active',
            $or: [{ actualQuantity: { $gt: 0 } }, { actualQuantity: { $exists: false }, quantity: { $gt: 0 } }],
          },
          { session },
        )
        .sort({ date: 1 })
        .toArray()
      const dates = enumerateBusinessDates(period.reservationFrom, period.weekEnd)
      const overrides = await dbCollections.mealDayOverrides
        .find({ date: { $in: dates } }, { session })
        .toArray()
      const overrideMap = new Map(overrides.map((item) => [item.date, item.status]))
      const activeReservations = reservations.filter(
        (reservation) =>
          (overrideMap.get(reservation.date) ?? getDefaultMealDayStatus(reservation.date)) === 'open',
      )

      const byMember = new Map<string, { memberId: ObjectId; items: { date: string; quantity: number }[] }>()
      for (const reservation of activeReservations) {
        const key = reservation.memberId.toHexString()
        const group = byMember.get(key) ?? { memberId: reservation.memberId, items: [] }
        group.items.push({ date: reservation.date, quantity: reservation.actualQuantity ?? reservation.quantity })
        byMember.set(key, group)
      }

      const bills: BillDocument[] = [...byMember.values()].map(({ memberId, items }) => {
        const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0)
        return {
          _id: new MongoObjectId(),
          memberId,
          weekStart: period.weekStart,
          weekEnd: period.weekEnd,
          items,
          totalQuantity,
          unitPriceFen: EGG_UNIT_PRICE_FEN,
          totalAmountFen: totalQuantity * EGG_UNIT_PRICE_FEN,
          status: 'draft',
          generatedAt,
          createdAt: generatedAt,
        }
      })

      if (bills.length > 0) await dbCollections.bills.insertMany(bills, { session })

      const totalQuantity = bills.reduce((sum, bill) => sum + bill.totalQuantity, 0)
      const totalAmountFen = bills.reduce((sum, bill) => sum + bill.totalAmountFen, 0)
      await dbCollections.billingRuns.insertOne(
        {
          weekStart: period.weekStart,
          weekEnd: period.weekEnd,
          billCount: bills.length,
          totalQuantity,
          totalAmountFen,
          status: 'draft',
          generatedAt,
        },
        { session },
      )
      result = {
        weekStart: period.weekStart,
        weekEnd: period.weekEnd,
        generated: true,
        billCount: bills.length,
        totalQuantity,
        totalAmountFen,
      }
    })
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      const concurrentRun = await collections(db).billingRuns.findOne({ weekStart: period.weekStart })
      if (concurrentRun) return presentExistingRun(concurrentRun)
    }
    throw error
  } finally {
    await session.endSession()
  }

  if (!result) throw new Error(`Billing draft generation produced no result for ${period.weekStart}`)
  return result
}

export async function publishBillsForPeriod(
  client: MongoClient,
  db: Db,
  period: BillingPeriod,
  publishedAt = new Date(),
): Promise<BillingPublishResult> {
  const session = client.startSession()
  let result: BillingPublishResult | null = null
  try {
    await session.withTransaction(async () => {
      const dbCollections = collections(db)
      const run = await dbCollections.billingRuns.findOne({ weekStart: period.weekStart }, { session })
      if (!run || run.status !== 'draft') {
        result = {
          weekStart: period.weekStart,
          weekEnd: run?.weekEnd ?? period.weekEnd,
          published: false,
          billCount: run?.billCount ?? 0,
          totalQuantity: run?.totalQuantity ?? 0,
          totalAmountFen: run?.totalAmountFen ?? 0,
        }
        return
      }

      const bills = await dbCollections.bills
        .find({ weekStart: period.weekStart, status: 'draft' }, { session })
        .toArray()
      const expiresAt = new Date(publishedAt.getTime() + 365 * 24 * 60 * 60 * 1000)
      if (bills.length > 0) {
        await dbCollections.notifications.insertMany(
          bills.map((bill) => {
            const totals = effectiveBillTotals(bill)
            return {
              receiverId: bill.memberId,
              type: 'bill_generated',
              title: '本周鸡蛋账单已生成',
              content: `本周鸡蛋账单共 ${totals.totalQuantity} 个，合计 ${formatYuan(totals.totalAmountFen)} 元${bill.adjustmentReason ? `（管理员已调整：${bill.adjustmentReason}）` : ''}`,
              relatedDate: bill.weekStart,
              relatedBillId: bill._id,
              isRead: false,
              createdAt: publishedAt,
              expiresAt,
            }
          }),
          { session },
        )
        await dbCollections.bills.updateMany(
          { weekStart: period.weekStart, status: 'draft' },
          { $set: { status: 'published', publishedAt } },
          { session },
        )
      }
      await dbCollections.billingRuns.updateOne(
        { weekStart: period.weekStart, status: 'draft' },
        { $set: { status: 'published', publishedAt } },
        { session },
      )
      result = {
        weekStart: run.weekStart,
        weekEnd: run.weekEnd,
        published: true,
        billCount: run.billCount,
        totalQuantity: run.totalQuantity,
        totalAmountFen: run.totalAmountFen,
      }
    })
  } finally {
    await session.endSession()
  }

  if (!result) throw new Error(`Billing publication produced no result for ${period.weekStart}`)
  return result
}

function presentExistingRun(run: {
  weekStart: string
  weekEnd: string
  billCount: number
  totalQuantity: number
  totalAmountFen: number
}): BillingGenerationResult {
  return { ...run, generated: false }
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
