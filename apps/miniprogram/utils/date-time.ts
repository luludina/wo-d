const CHINA_TIME_OFFSET_MS = 8 * 60 * 60 * 1000

interface ChinaDateParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

function chinaDateParts(value: string): ChinaDateParts {
  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) throw new Error('日期格式无效')

  const shifted = new Date(timestamp + CHINA_TIME_OFFSET_MS)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  }
}

export function formatChinaMonthDayTime(value: string): string {
  const parts = chinaDateParts(value)
  return `${parts.month}/${parts.day} ${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`
}

export function formatChinaDate(value: string): string {
  const parts = chinaDateParts(value)
  return `${parts.year}/${parts.month}/${parts.day}`
}
