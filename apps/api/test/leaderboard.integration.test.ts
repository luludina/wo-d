import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ObjectId } from 'mongodb'
import { buildApp } from '../src/app.js'
import { collections } from '../src/db/collections.js'
import { loadLeaderboard } from '../src/domain/leaderboard.js'

const mongoUri = process.env.MONGO_TEST_URI
const integration = mongoUri ? describe : describe.skip
const dbName = `egg_booking_leaderboard_test_${Date.now()}`

integration('egg leaderboard with MongoDB', () => {
  const app = buildApp({ mongo: { uri: mongoUri!, dbName } })
  const currentUserId = new ObjectId()
  const tiedMemberId = new ObjectId()
  const zeroMemberId = new ObjectId()
  const disabledMemberId = new ObjectId()

  beforeAll(async () => {
    await app.ready()
    const now = new Date('2026-10-13T08:00:00+08:00')
    const { users, reservations, mealDayOverrides } = collections(app.mongo.db)
    await users.insertMany([
      { _id: currentUserId, openid: 'current', nickname: '张三', memberStatus: 'approved', isAdmin: true, createdAt: now, updatedAt: now },
      { _id: tiedMemberId, openid: 'tied', nickname: '李四', memberStatus: 'approved', isAdmin: false, createdAt: now, updatedAt: now },
      { _id: zeroMemberId, openid: 'zero', nickname: '王五', memberStatus: 'approved', isAdmin: false, createdAt: now, updatedAt: now },
      { _id: disabledMemberId, openid: 'disabled', nickname: '停用', memberStatus: 'disabled', isAdmin: false, createdAt: now, updatedAt: now },
    ])
    await reservations.insertMany([
      { memberId: currentUserId, date: '2026-10-12', quantity: 2, status: 'active', createdAt: now, updatedAt: now },
      { memberId: currentUserId, date: '2026-10-13', quantity: 1, status: 'active', createdAt: now, updatedAt: now },
      { memberId: tiedMemberId, date: '2026-10-12', quantity: 3, status: 'active', createdAt: now, updatedAt: now },
      { memberId: zeroMemberId, date: '2026-10-13', quantity: 0, status: 'active', createdAt: now, updatedAt: now },
      { memberId: disabledMemberId, date: '2026-10-12', quantity: 5, status: 'active', createdAt: now, updatedAt: now },
      { memberId: currentUserId, date: '2026-10-14', quantity: 5, status: 'active', createdAt: now, updatedAt: now },
      { memberId: tiedMemberId, date: '2026-10-11', quantity: 4, status: 'active', createdAt: now, updatedAt: now },
    ])
    await mealDayOverrides.insertOne({
      date: '2026-10-11', status: 'open', version: 1, updatedBy: currentUserId, createdAt: now, updatedAt: now,
    })
  })

  afterAll(async () => {
    await app.mongo.db.dropDatabase()
    await app.close()
  })

  it('ranks approved members using effective reservations through today', async () => {
    const result = await loadLeaderboard(app.mongo.db, currentUserId, 'week', new Date('2026-10-13T08:00:00+08:00'))
    expect(result.periodStart).toBe('2026-10-12')
    expect(result.periodEnd).toBe('2026-10-18')
    expect(result.totalQuantity).toBe(6)
    expect(result.myRank).toBe(1)
    expect(result.items.map(({ nickname, quantity, rank }) => ({ nickname, quantity, rank }))).toEqual([
      { nickname: '李四', quantity: 3, rank: 1 },
      { nickname: '张三', quantity: 3, rank: 1 },
      { nickname: '王五', quantity: 0, rank: null },
    ])
  })
})
