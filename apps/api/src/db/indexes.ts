import type { Db } from 'mongodb'
import { collections } from './collections.js'

export async function ensureIndexes(db: Db): Promise<void> {
  const {
    users,
    sessions,
    auditLogs,
    mealDayOverrides,
    reservations,
    bills,
    billingRuns,
    notifications,
    idempotencyKeys,
  } = collections(db)

  await Promise.all([
    users.createIndex({ openid: 1 }, { unique: true, name: 'openid_unique' }),
    users.createIndex({ memberStatus: 1, createdAt: -1 }, { name: 'member_status_created_at' }),
    users.createIndex({ isAdmin: 1, memberStatus: 1 }, { name: 'admin_member_status' }),
    sessions.createIndex({ tokenHash: 1 }, { unique: true, name: 'token_hash_unique' }),
    sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'expires_at_ttl' }),
    sessions.createIndex({ userId: 1, expiresAt: 1 }, { name: 'user_expires_at' }),
    auditLogs.createIndex({ actorUserId: 1, createdAt: -1 }, { name: 'actor_created_at' }),
    auditLogs.createIndex({ targetType: 1, targetId: 1, createdAt: -1 }, { name: 'target_created_at' }),
    auditLogs.createIndex({ action: 1, createdAt: -1 }, { name: 'action_created_at' }),
    mealDayOverrides.createIndex({ date: 1 }, { unique: true, name: 'date_unique' }),
    reservations.createIndex({ memberId: 1, date: 1 }, { unique: true, name: 'member_date_unique' }),
    reservations.createIndex({ date: 1, status: 1 }, { name: 'date_status' }),
    bills.createIndex({ memberId: 1, weekStart: 1 }, { unique: true, name: 'member_week_unique' }),
    bills.createIndex({ memberId: 1, weekStart: -1 }, { name: 'member_week_desc' }),
    billingRuns.createIndex({ weekStart: 1 }, { unique: true, name: 'week_start_unique' }),
    notifications.createIndex(
      { receiverId: 1, isRead: 1, createdAt: -1 },
      { name: 'receiver_read_created_at' },
    ),
    notifications.createIndex({ receiverId: 1, createdAt: -1 }, { name: 'receiver_created_at' }),
    notifications.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'expires_at_ttl' }),
    idempotencyKeys.createIndex(
      { actorUserId: 1, action: 1, key: 1 },
      { unique: true, name: 'actor_action_key_unique' },
    ),
    idempotencyKeys.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'expires_at_ttl' }),
  ])
}
