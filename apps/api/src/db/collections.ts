import type { Db } from 'mongodb'
import type {
  AuditLogDocument,
  BillDocument,
  BillingRunDocument,
  IdempotencyKeyDocument,
  MealDayOverrideDocument,
  NotificationDocument,
  ReservationDocument,
  SessionDocument,
  UserDocument,
} from './models.js'

export function collections(db: Db) {
  return {
    users: db.collection<UserDocument>('users'),
    sessions: db.collection<SessionDocument>('sessions'),
    auditLogs: db.collection<AuditLogDocument>('audit_logs'),
    mealDayOverrides: db.collection<MealDayOverrideDocument>('meal_day_overrides'),
    reservations: db.collection<ReservationDocument>('reservations'),
    bills: db.collection<BillDocument>('bills'),
    billingRuns: db.collection<BillingRunDocument>('billing_runs'),
    notifications: db.collection<NotificationDocument>('notifications'),
    idempotencyKeys: db.collection<IdempotencyKeyDocument>('idempotency_keys'),
  }
}
