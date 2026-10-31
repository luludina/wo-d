import { formatBusinessDate, getShanghaiToday, parseBusinessDate } from './business-date.js'

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

export function getBillingPeriodForDate(
  billingStartDate: string,
  date = getShanghaiToday(),
): BillingPeriod {
  parseBusinessDate(billingStartDate)
  const { weekStart } = getBillingWeek(date)
  return {
    weekStart,
    weekEnd: addDays(weekStart, 4),
    reservationFrom: weekStart < billingStartDate ? billingStartDate : weekStart,
  }
}

export function getLatestDueWeekEnd(now = new Date(), cutoffTime = '18:00'): string {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  const current = getBillingWeek(today)
  const currentFriday = addDays(current.weekStart, 4)
  const isDue = today > currentFriday
    || (today === currentFriday && shanghaiTimeFormatter.format(now) >= cutoffTime)
  return isDue ? currentFriday : addDays(current.weekStart, -3)
}

export function enumerateDueBillingPeriods(
  startDate: string,
  now = new Date(),
  cutoffTime = '18:00',
): BillingPeriod[] {
  parseBusinessDate(startDate)
  const firstWeek = getBillingWeek(startDate)
  const latestDueWeekEnd = getLatestDueWeekEnd(now, cutoffTime)
  if (addDays(firstWeek.weekStart, 4) > latestDueWeekEnd) return []

  const periods: BillingPeriod[] = []
  for (
    let weekStart = firstWeek.weekStart;
    addDays(weekStart, 4) <= latestDueWeekEnd;
    weekStart = addDays(weekStart, 7)
  ) {
    periods.push({
      weekStart,
      weekEnd: addDays(weekStart, 4),
      reservationFrom: weekStart < startDate ? startDate : weekStart,
    })
  }
  return periods
}
