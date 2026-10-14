import { formatBusinessDate, parseBusinessDate } from './business-date.js'

const shanghaiTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Shanghai',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export interface BillingPeriod {
  weekStart: string
  weekEnd: string
  reservationFrom: string
}

function addDays(date: string, days: number): string {
  return formatBusinessDate(new Date(parseBusinessDate(date).getTime() + days * 86_400_000))
}

export function getBillingWeek(date: string): Pick<BillingPeriod, 'weekStart' | 'weekEnd'> {
  const parsed = parseBusinessDate(date)
  const daysSinceMonday = (parsed.getUTCDay() + 6) % 7
  const weekStart = addDays(date, -daysSinceMonday)
  return { weekStart, weekEnd: addDays(weekStart, 6) }
}

export function getLatestDueWeekEnd(now = new Date()): string {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  const current = getBillingWeek(today)
  const isDue = today === current.weekEnd && shanghaiTimeFormatter.format(now) >= '18:00'
  return isDue ? current.weekEnd : addDays(current.weekStart, -1)
}

export function enumerateDueBillingPeriods(startDate: string, now = new Date()): BillingPeriod[] {
  parseBusinessDate(startDate)
  const firstWeek = getBillingWeek(startDate)
  const latestDueWeekEnd = getLatestDueWeekEnd(now)
  if (firstWeek.weekEnd > latestDueWeekEnd) return []

  const periods: BillingPeriod[] = []
  for (
    let weekStart = firstWeek.weekStart;
    addDays(weekStart, 6) <= latestDueWeekEnd;
    weekStart = addDays(weekStart, 7)
  ) {
    periods.push({
      weekStart,
      weekEnd: addDays(weekStart, 6),
      reservationFrom: weekStart < startDate ? startDate : weekStart,
    })
  }
  return periods
}
