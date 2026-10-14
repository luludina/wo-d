import { describe, expect, it } from 'vitest'
import {
  enumerateDueBillingPeriods,
  getBillingWeek,
  getLatestDueWeekEnd,
} from '../src/domain/billing-period.js'

describe('weekly billing periods', () => {
  it('uses natural Monday-to-Sunday weeks', () => {
    expect(getBillingWeek('2026-10-09')).toEqual({
      weekStart: '2026-10-05',
      weekEnd: '2026-10-11',
    })
    expect(getBillingWeek('2027-01-01')).toEqual({
      weekStart: '2026-12-28',
      weekEnd: '2027-01-03',
    })
  })

  it('does not make the current week due before Sunday 18:00 Shanghai time', () => {
    expect(getLatestDueWeekEnd(new Date('2026-10-11T17:59:59+08:00'))).toBe('2026-10-04')
    expect(enumerateDueBillingPeriods('2026-10-09', new Date('2026-10-11T17:59:59+08:00'))).toEqual([])
  })

  it('makes the launch week due at Sunday 18:00 and starts from launch date', () => {
    expect(getLatestDueWeekEnd(new Date('2026-10-11T18:00:00+08:00'))).toBe('2026-10-11')
    expect(enumerateDueBillingPeriods('2026-10-09', new Date('2026-10-11T18:00:00+08:00'))).toEqual([
      {
        weekStart: '2026-10-05',
        weekEnd: '2026-10-11',
        reservationFrom: '2026-10-09',
      },
    ])
  })

  it('returns every missed week so a restarted server can catch up', () => {
    expect(enumerateDueBillingPeriods('2026-10-09', new Date('2026-10-19T08:00:00+08:00'))).toEqual([
      {
        weekStart: '2026-10-05',
        weekEnd: '2026-10-11',
        reservationFrom: '2026-10-09',
      },
      {
        weekStart: '2026-10-12',
        weekEnd: '2026-10-18',
        reservationFrom: '2026-10-12',
      },
    ])
  })
})
