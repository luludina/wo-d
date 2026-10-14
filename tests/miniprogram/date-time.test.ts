import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatChinaDate,
  formatChinaMonthDayTime,
} from '../../apps/miniprogram/utils/date-time.ts'

test('formats Beijing time without relying on Intl', () => {
  const originalIntl = globalThis.Intl

  try {
    Object.defineProperty(globalThis, 'Intl', { configurable: true, value: undefined })

    assert.equal(formatChinaMonthDayTime('2026-10-09T16:05:00.000Z'), '10/10 00:05')
    assert.equal(formatChinaDate('2026-10-09T16:05:00.000Z'), '2026/10/10')
  } finally {
    Object.defineProperty(globalThis, 'Intl', { configurable: true, value: originalIntl })
  }
})
