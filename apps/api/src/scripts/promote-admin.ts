import { existsSync } from 'node:fs'
import { loadEnvFile } from 'node:process'
import { MongoClient, ObjectId } from 'mongodb'
import { collections } from '../db/collections.js'
import { ensureIndexes } from '../db/indexes.js'

if (existsSync('.env')) loadEnvFile('.env')

function readUserId(argv: string[]): string {
  const index = argv.indexOf('--user-id')
  const value = index >= 0 ? argv[index + 1] : undefined
  if (!value || !ObjectId.isValid(value)) {
    throw new Error('Usage: pnpm admin:promote --user-id <24-character-user-id>')
  }
  return value
}

const targetId = new ObjectId(readUserId(process.argv.slice(2)))
const mongoUri = process.env.MONGO_URI
if (!mongoUri) throw new Error('MONGO_URI is required')
const mongoDbName = process.env.MONGO_DB_NAME ?? 'egg_booking'
const client = new MongoClient(mongoUri)

try {
  await client.connect()
  const db = client.db(mongoDbName)
  await ensureIndexes(db)
  const mongoSession = client.startSession()

  try {
    await mongoSession.withTransaction(async () => {
      const { users, auditLogs } = collections(db)
      const target = await users.findOne({ _id: targetId }, { session: mongoSession })
      if (!target) throw new Error('User not found')
      if (target.isAdmin && target.memberStatus === 'approved') return

      const existingAdmin = await users.findOne(
        { isAdmin: true, memberStatus: 'approved' },
        { session: mongoSession },
      )
      if (existingAdmin) {
        throw new Error('An active administrator already exists; use the admin API for later appointments')
      }

      const now = new Date()
      await users.updateOne(
        { _id: targetId },
        {
          $set: { memberStatus: 'approved', isAdmin: true, updatedAt: now },
          $unset: { rejectionReason: '' },
        },
        { session: mongoSession },
      )
      await auditLogs.insertOne(
        {
          actorUserId: targetId,
          action: 'bootstrap-admin',
          targetType: 'user',
          targetId: targetId.toHexString(),
          before: {
            memberStatus: target.memberStatus,
            isAdmin: target.isAdmin,
          },
          after: { memberStatus: 'approved', isAdmin: true },
          createdAt: now,
        },
        { session: mongoSession },
      )
    })
  } finally {
    await mongoSession.endSession()
  }

  console.log(`Administrator initialized: ${targetId.toHexString()}`)
} finally {
  await client.close()
}
