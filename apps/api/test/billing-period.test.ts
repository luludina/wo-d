import { describe, expect, it } from 'vitest'
import {
  enumerateDueBillingPeriods,
  getBillingPeriodForDate,
  getBillingWeek,
  getLatestDueWeekEnd,
} from '../src/domain/billing-period.js'

describe('weekly billing periods', () => {
  it('calculates the containing natural week', () => {
    expect(getBillingWeek('2026-10-09')).toEqual({
      weekStart: '2026-10-05',
      weekEnd: '2026-10-11',
    })
    expect(getBillingWeek('2027-01-01')).toEqual({
      weekStart: '2026-12-28',
      weekEnd: '2027-01-03',
    })
  })

  it('builds a Monday-to-Friday period for manual generation', () => {
    expect(getBillingPeriodForDate('2026-10-09', '2026-10-23')).toEqual({
      weekStart: '2026-10-19',
      weekEnd: '2026-10-23',
      reservationFrom: '2026-10-19',
    })
    expect(getBillingPeriodForDate('2026-10-09', '2026-10-09')).toEqual({
      weekStart: '2026-10-05',
      weekEnd: '2026-10-09',
      reservationFrom: '2026-10-09',
    })
  })

  it('uses the requested Friday cutoff in Shanghai time', () => {
    expect(getLatestDueWeekEnd(new Date('2026-10-09T16:59:59+08:00'), '17:00')).toBe('2026-10-02')
    expect(getLatestDueWeekEnd(new Date('2026-10-09T17:00:00+08:00'), '17:00')).toBe('2026-10-09')
    expect(getLatestDueWeekEnd(new Date('2026-10-09T17:59:59+08:00'))).toBe('2026-10-02')
    expect(enumerateDueBillingPeriods('2026-10-09', new Date('2026-10-09T17:59:59+08:00'))).toEqual([])
    expect(enumerateDueBillingPeriods('2026-10-09', new Date('2026-10-09T17:00:00+08:00'), '17:00')).toHaveLength(1)
  })

  it('makes the launch week due at Friday 18:00 and starts from launch date', () => {
    expect(getLatestDueWeekEnd(new Date('2026-10-09T18:00:00+08:00'))).toBe('2026-10-09')
    expect(enumerateDueBillingPeriods('2026-10-09', new Date('2026-10-09T18:00:00+08:00'))).toEqual([
      {
        weekStart: '2026-10-05',
        weekEnd: '2026-10-09',
        reservationFrom: '2026-10-09',
      },
    ])
  })

  it('keeps Friday due through the weekend so a restarted server can catch up', () => {
    expect(getLatestDueWeekEnd(new Date('2026-10-10T08:00:00+08:00'))).toBe('2026-10-09')
    expect(getLatestDueWeekEnd(new Date('2026-10-11T23:59:59+08:00'))).toBe('2026-10-09')
    expect(enumerateDueBillingPeriods('2026-10-09', new Date('2026-10-10T08:00:00+08:00'))).toEqual([
      {
        weekStart: '2026-10-05',
        weekEnd: '2026-10-09',
        reservationFrom: '2026-10-09',
      },
    ])
  })

  it('returns every missed week so a restarted server can catch up', () => {
    expect(enumerateDueBillingPeriods('2026-10-09', new Date('2026-10-19T08:00:00+08:00'))).toEqual([
      {
        weekStart: '2026-10-05',
        weekEnd: '2026-10-09',
        reservationFrom: '2026-10-09',
      },
      {
        weekStart: '2026-10-12',
        weekEnd: '2026-10-16',
        reservationFrom: '2026-10-12',
      },
    ])
  })
})
