import type { MealDayStatus } from '@egg-booking/contracts'
import { AppError } from '../lib/errors.js'

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const shanghaiDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function parseBusinessDate(value: string): Date {
  const match = DATE_PATTERN.exec(value)
  if (!match) throw new AppError(400, 'DATE_INVALID', '日期格式必须为 YYYY-MM-DD')
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new AppError(400, 'DATE_INVALID', '日期不存在')
  }
  return date
}

export function formatBusinessDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function getShanghaiToday(now = new Date()): string {
  return shanghaiDateFormatter.format(now)
}

export function getBookingWindowEnd(today: string): string {
  const date = parseBusinessDate(today)
  return formatBusinessDate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 2, 0)))
}

export function getBookingWindowStart(today: string): string {
  const date = parseBusinessDate(today)
  return formatBusinessDate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)))
}

export function getReservationWindowEnd(today: string): string {
  const date = parseBusinessDate(today)
  const targetYear = date.getUTCMonth() === 11 ? date.getUTCFullYear() + 1 : date.getUTCFullYear()
  const targetMonth = (date.getUTCMonth() + 1) % 12
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()
  return formatBusinessDate(new Date(Date.UTC(targetYear, targetMonth, Math.min(date.getUTCDate(), lastDay))))
}

export function enumerateBusinessDates(from: string, to: string, maximum = 62): string[] {
  const start = parseBusinessDate(from)
  const end = parseBusinessDate(to)
  if (start > end) throw new AppError(400, 'DATE_RANGE_INVALID', '开始日期不能晚于结束日期')

  const dates: string[] = []
  for (let cursor = start; cursor <= end; cursor = new Date(cursor.getTime() + 86_400_000)) {
    dates.push(formatBusinessDate(cursor))
    if (dates.length > maximum) {
      throw new AppError(400, 'DATE_RANGE_TOO_LARGE', `一次最多设置 ${maximum} 天`)
    }
  }
  return dates
}

export function assertMealDayWindow(from: string, to: string, now = new Date()): string[] {
  const today = getShanghaiToday(now)
  const end = getReservationWindowEnd(today)
  if (from < today || to > end) {
    throw new AppError(400, 'MEAL_DAY_WINDOW_INVALID', `只能设置 ${today} 至 ${end} 的供餐日`)
  }
  return enumerateBusinessDates(from, to)
}

export function assertMealDayActionWindow(
  from: string,
  to: string,
  status: MealDayStatus,
  now = new Date(),
): string[] {
  const dates = assertMealDayWindow(from, to, now)
  const today = getShanghaiToday(now)
  if (status === 'closed' && from <= today) {
    throw new AppError(400, 'MEAL_DAY_CLOSE_TOO_LATE', '关闭供餐最早只能从明天开始')
  }
  return dates
}

export function getDefaultMealDayStatus(date: string): MealDayStatus {
  const weekday = parseBusinessDate(date).getUTCDay()
  return weekday === 0 || weekday === 6 ? 'closed' : 'open'
}

export function assertReservationQueryWindow(from: string, to: string, now = new Date()): string[] {
  const today = getShanghaiToday(now)
  const end = getBookingWindowEnd(today)
  if (to > end) {
    throw new AppError(400, 'RESERVATION_WINDOW_INVALID', `未来最多只能查询至 ${end}`)
  }
  return enumerateBusinessDates(from, to)
}

export function assertReservationDateInWindow(date: string, now = new Date()): void {
  parseBusinessDate(date)
  const today = getShanghaiToday(now)
  const end = getReservationWindowEnd(today)
  if (date < today || date > end) {
    throw new AppError(400, 'RESERVATION_WINDOW_INVALID', `只能预约 ${today} 至 ${end}`)
  }
}

export function assertReservationWriteDate(date: string, now = new Date()): void {
  assertReservationDateInWindow(date, now)
  if (isReservationLocked(date, now)) {
    throw new AppError(409, 'RESERVATION_LOCKED', '当天预约已于 09:00 截止')
  }
}

export function isReservationLocked(date: string, now = new Date()): boolean {
  const today = getShanghaiToday(now)
  if (date < today) return true
  if (date > today) return false
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now)
  return time >= '09:00'
}
