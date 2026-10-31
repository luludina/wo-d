export const memberStatuses = [
  'draft',
  'pending',
  'approved',
  'rejected',
  'disabled',
] as const

export type MemberStatus = (typeof memberStatuses)[number]

export const reservationStatuses = ['active', 'cancelled'] as const

export type ReservationStatus = (typeof reservationStatuses)[number]

export const mealDayStatuses = ['open', 'closed'] as const

export type MealDayStatus = (typeof mealDayStatuses)[number]

export interface ApiErrorBody {
  code: string
  message: string
  requestId: string
}

export interface HealthBody {
  status: 'ok' | 'unavailable'
}

export interface CurrentUser {
  id: string
  avatarUrl?: string
  nickname?: string
  realName?: string
  department?: string
  phone?: string
  memberStatus: MemberStatus
  isAdmin: boolean
  rejectionReason?: string
  createdAt: string
  updatedAt: string
}

export interface LoginBody {
  token: string
  expiresAt: string
  user: CurrentUser
}

export interface MemberListBody {
  items: CurrentUser[]
}

export interface MealDayItem {
  date: string
  status: MealDayStatus
  source: 'default' | 'override'
  reason?: string
  version?: number
}

export interface MealDayListBody {
  items: MealDayItem[]
}

export interface MealDayChange {
  date: string
  before: MealDayStatus
  after: MealDayStatus
  cancelledReservationCount: number
  cancelledEggCount: number
}

export interface MealDayBatchPreview {
  from: string
  to: string
  status: MealDayStatus
  changes: MealDayChange[]
  changedDateCount: number
  affectedMemberCount: number
  cancelledReservationCount: number
  cancelledEggCount: number
  previewToken: string
}

export interface ReservationView {
  quantity: number
  status: ReservationStatus
  isLocked: boolean
  cancelledReason?: 'meal_day_closed' | 'member_disabled'
}

export interface ReservationCalendarItem extends MealDayItem {
  isLocked: boolean
  reservation: ReservationView | null
}

export interface ReservationCalendarBody {
  items: ReservationCalendarItem[]
}

export interface ReservationBatchResult {
  applied: ReservationCalendarItem[]
  skippedClosedDates: string[]
  skippedLockedDates: string[]
}

export interface ReservationDayMember {
  memberId: string
  nickname: string
  avatarUrl?: string
}

export interface ReservationDaySubmission extends ReservationDayMember {
  quantity: number
}

export interface ReservationDayDetailsBody {
  date: string
  totalEggs: number
  filledMemberCount: number
  unsubmittedMemberCount: number
  billingGenerated?: boolean
  items: ReservationDaySubmission[]
  unsubmittedItems: ReservationDayMember[]
}

export interface AdminTodaySummaryBody {
  date: string
  status: MealDayStatus
  isLocked: boolean
  totalEggs: number
  filledMemberCount: number
  unfilledMemberCount: number
  tomorrowDate: string
  tomorrowStatus: MealDayStatus
  tomorrowTotalEggs: number
}

export interface MyEggStatsBody {
  weekStart: string
  throughDate: string
  weekQuantity: number
  totalQuantity: number
}

export type LeaderboardPeriod = 'week' | 'month' | 'year'

export interface LeaderboardMember {
  memberId: string
  nickname: string
  avatarUrl?: string
  quantity: number
  rank: number | null
  isCurrentUser: boolean
}

export interface LeaderboardBody {
  period: LeaderboardPeriod
  periodStart: string
  periodEnd: string
  throughDate: string
  myRank: number | null
  myQuantity: number
  totalQuantity: number
  items: LeaderboardMember[]
}

export interface NotificationView {
  id: string
  type: string
  title: string
  content: string
  relatedDate?: string
  relatedBillId?: string
  isRead: boolean
  createdAt: string
}

export interface NotificationListBody {
  items: NotificationView[]
  unreadCount: number
  page: number
  limit: number
  totalCount: number
  totalPages: number
  hasMore: boolean
}

export interface BillLineItem {
  date: string
  quantity: number
}

export interface BillSummary {
  id: string
  weekStart: string
  weekEnd: string
  totalQuantity: number
  unitPriceFen: number
  totalAmountFen: number
  generatedAt: string
  originalTotalQuantity: number
  originalTotalAmountFen: number
  isAdjusted: boolean
  adjustmentReason?: string
  adjustedAt?: string
}

export interface BillDetail extends BillSummary {
  items: BillLineItem[]
}

export interface BillListBody {
  items: BillSummary[]
}

export interface AdminBillRunSummary {
  weekStart: string
  weekEnd: string
  memberCount: number
  totalQuantity: number
  totalAmountFen: number
  status: 'draft' | 'published'
  generatedAt: string
  publishedAt?: string
}

export interface AdminBillRunListBody {
  currentWeekStart: string
  canGenerateCurrentWeek: boolean
  items: AdminBillRunSummary[]
}

export interface AdminBillMemberItem {
  billId: string
  memberId: string
  realName: string
  avatarUrl?: string
  totalQuantity: number
  totalAmountFen: number
  originalTotalQuantity: number
  originalTotalAmountFen: number
  isAdjusted: boolean
  adjustmentReason?: string
  adjustedAt?: string
}

export interface AdminBillRunDetail extends AdminBillRunSummary {
  items: AdminBillMemberItem[]
}
