import type { MealDayStatus, MemberStatus, ReservationStatus } from '@egg-booking/contracts'
import type { ObjectId } from 'mongodb'

export interface UserDocument {
  openid: string
  avatarUrl?: string
  nickname?: string
  realName?: string
  department?: string
  phone?: string
  memberStatus: MemberStatus
  isAdmin: boolean
  rejectionReason?: string
  createdAt: Date
  updatedAt: Date
}

export interface SessionDocument {
  userId: ObjectId
  tokenHash: string
  expiresAt: Date
  createdAt: Date
  lastUsedAt: Date
}

export interface AuditLogDocument {
  actorUserId: ObjectId
  action: string
  targetType: string
  targetId: string
  before?: unknown
  after?: unknown
  reason?: string
  requestId?: string
  createdAt: Date
}

export interface MealDayOverrideDocument {
  date: string
  status: MealDayStatus
  reason?: string
  version: number
  updatedBy: ObjectId
  createdAt: Date
  updatedAt: Date
}

export interface ReservationDocument {
  memberId: ObjectId
  date: string
  quantity: number
  status: ReservationStatus
  cancelledReason?: 'meal_day_closed' | 'member_disabled'
  createdAt: Date
  updatedAt: Date
}

export interface NotificationDocument {
  receiverId: ObjectId
  type: string
  title: string
  content: string
  relatedDate?: string
  relatedBillId?: ObjectId
  isRead: boolean
  readAt?: Date
  createdAt: Date
  expiresAt: Date
}

export interface BillLineItemDocument {
  date: string
  quantity: number
}

export interface BillDocument {
  _id: ObjectId
  memberId: ObjectId
  weekStart: string
  weekEnd: string
  items: BillLineItemDocument[]
  totalQuantity: number
  unitPriceFen: number
  totalAmountFen: number
  generatedAt: Date
  createdAt: Date
}

export interface BillingRunDocument {
  weekStart: string
  weekEnd: string
  billCount: number
  totalQuantity: number
  totalAmountFen: number
  generatedAt: Date
}

export interface IdempotencyKeyDocument {
  actorUserId: ObjectId
  action: string
  key: string
  response: unknown
  createdAt: Date
  expiresAt: Date
}
