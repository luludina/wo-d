import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ObjectId } from 'mongodb'
import { buildApp } from '../src/app.js'
import { collections } from '../src/db/collections.js'
import { loadMyEggStats } from '../src/domain/egg-stats.js'

const mongoUri = process.env.MONGO_TEST_URI
const integration = mongoUri ? describe : describe.skip
const dbName = `egg_booking_egg_stats_test_${Date.now()}`

integration('personal egg statistics with MongoDB', () => {
  const app = buildApp({ mongo: { uri: mongoUri!, dbName } })
  const memberId = new ObjectId()

  beforeAll(async () => {
    await app.ready()
    const now = new Date('2026-10-11T12:00:00+08:00')
    const { reservations, mealDayOverrides } = collections(app.mongo.db)
    await reservations.insertMany([
      { memberId, date: '2026-10-08', quantity: 5, status: 'active', createdAt: now, updatedAt: now },
      { memberId, date: '2026-10-09', quantity: 2, status: 'active', createdAt: now, updatedAt: now },
      { memberId, date: '2026-10-10', quantity: 3, status: 'active', createdAt: now, updatedAt: now },
      { memberId, date: '2026-10-11', quantity: 4, status: 'cancelled', cancelledReason: 'meal_day_closed', createdAt: now, updatedAt: now },
      { memberId, date: '2026-10-12', quantity: 5, status: 'active', createdAt: now, updatedAt: now },
    ])
    await mealDayOverrides.insertOne({
      date: '2026-10-10',
      status: 'open',
      version: 1,
      updatedBy: memberId,
      createdAt: now,
      updatedAt: now,
    })
  })

  afterAll(async () => {
    await app.mongo.db.dropDatabase()
    await app.close()
  })

  it('counts effective reservations from launch through today but excludes future dates', async () => {
    const result = await loadMyEggStats(
      app.mongo.db,
      memberId,
      '2026-10-09',
      new Date('2026-10-11T12:00:00+08:00'),
    )
    expect(result).toEqual({
      weekStart: '2026-10-05',
      throughDate: '2026-10-11',
      weekQuantity: 5,
      totalQuantity: 5,
    })
  })
})
