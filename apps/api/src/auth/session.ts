import { createHmac, randomBytes } from 'node:crypto'
import type { Db, ObjectId } from 'mongodb'
import { collections } from '../db/collections.js'

export function hashSessionToken(token: string, secret: string): string {
  return createHmac('sha256', secret).update(token).digest('hex')
}

export async function createSession(
  db: Db,
  userId: ObjectId,
  secret: string,
  ttlDays: number,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url')
  const now = new Date()
  const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000)

  await collections(db).sessions.insertOne({
    userId,
    tokenHash: hashSessionToken(token, secret),
    expiresAt,
    createdAt: now,
    lastUsedAt: now,
  })

  return { token, expiresAt }
}
