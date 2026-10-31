import { describe, expect, it } from 'vitest'
import {
  assertMealDayActionWindow,
  assertMealDayWindow,
  assertReservationQueryWindow,
  assertReservationWriteDate,
  enumerateBusinessDates,
  getBookingWindowEnd,
  getDefaultMealDayStatus,
  getReservationWindowEnd,
  getShanghaiToday,
  isReservationLocked,
  parseBusinessDate,
} from '../src/domain/business-date.js'

describe('business date rules', () => {
  it('uses Shanghai time for today and ends at the end of next month', () => {
    const beforeMidnightUtc = new Date('2026-09-30T15:59:59.000Z')
    const afterMidnightShanghai = new Date('2026-09-30T16:00:00.000Z')

    expect(getShanghaiToday(beforeMidnightUtc)).toBe('2026-09-30')
    expect(getShanghaiToday(afterMidnightShanghai)).toBe('2026-10-01')
    expect(getBookingWindowEnd('2026-09-28')).toBe('2026-10-31')
    expect(getReservationWindowEnd('2026-09-28')).toBe('2026-10-28')
    expect(getReservationWindowEnd('2026-01-31')).toBe('2026-02-28')
    expect(getReservationWindowEnd('2028-01-31')).toBe('2028-02-29')
  })

  it('locks the current date at 09:00 Shanghai time', () => {
    expect(isReservationLocked('2026-09-28', new Date('2026-09-28T08:59:59+08:00'))).toBe(false)
    expect(isReservationLocked('2026-09-28', new Date('2026-09-28T09:00:00+08:00'))).toBe(true)
    expect(isReservationLocked('2026-09-27', new Date('2026-09-28T08:00:00+08:00'))).toBe(true)
    expect(isReservationLocked('2026-09-29', new Date('2026-09-28T10:00:00+08:00'))).toBe(false)
  })

  it('opens weekdays and closes weekends by default', () => {
    expect(getDefaultMealDayStatus('2026-09-28')).toBe('open')
    expect(getDefaultMealDayStatus('2026-10-03')).toBe('closed')
    expect(getDefaultMealDayStatus('2026-10-04')).toBe('closed')
  })

  it('validates real dates and range order while allowing any meal-day date', () => {
    expect(() => parseBusinessDate('2026-02-30')).toThrow('日期不存在')
    expect(() => enumerateBusinessDates('2026-10-02', '2026-10-01')).toThrow(
      '开始日期不能晚于结束日期',
    )
    expect(() =>
      assertMealDayWindow('2020-01-01', '2020-01-01'),
    ).not.toThrow()
    expect(() =>
      assertMealDayWindow('2035-12-31', '2035-12-31'),
    ).not.toThrow()
  })

  it('allows changing today at any time', () => {
    expect(() =>
      assertMealDayActionWindow('2026-09-28', '2026-09-28'),
    ).not.toThrow()
    expect(() =>
      assertMealDayActionWindow('2026-09-29', '2026-09-29'),
    ).not.toThrow()
  })

  it('allows historical calendar reads but limits writes to one rolling month', () => {
    const now = new Date('2026-09-30T08:00:00+08:00')
    expect(assertReservationQueryWindow('2025-01-01', '2025-01-31', now)).toHaveLength(31)
    expect(() => assertReservationWriteDate('2026-10-30', now)).not.toThrow()
    expect(() => assertReservationWriteDate('2026-10-31', now)).toThrow('只能预约')
    expect(() =>
      assertReservationWriteDate('2026-09-30', new Date('2026-09-30T09:00:00+08:00')),
    ).toThrow('已于 09:00 截止')
  })
})
