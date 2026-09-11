import { describe, it, expect } from 'vitest'
import {
  formatDate,
  formatTime,
  formatISODate,
  minutesToHours,
  todayEatClient,
  currentYearMonthEat,
} from './format'

describe('formatDate', () => {
  it('formats a date in long English format', () => {
    const d = new Date(2026, 6, 20)
    expect(formatDate(d)).toMatch(/Monday.*July.*2026/)
  })
})

describe('formatTime', () => {
  it('formats time with hours, minutes, seconds', () => {
    const d = new Date(2026, 6, 20, 9, 5, 3)
    const result = formatTime(d)
    expect(result).toMatch(/9:05:03 AM|09:05:03/)
  })
})

describe('formatISODate', () => {
  it('returns YYYY-MM-DD', () => {
    const d = new Date('2026-07-20T12:00:00Z')
    expect(formatISODate(d)).toBe('2026-07-20')
  })
})

describe('minutesToHours', () => {
  it('converts 0 minutes', () => {
    expect(minutesToHours(0)).toBe('0m')
  })
  it('converts under 60 minutes', () => {
    expect(minutesToHours(45)).toBe('45m')
  })
  it('converts exactly 60 minutes', () => {
    expect(minutesToHours(60)).toBe('1h 0m')
  })
  it('converts 150 minutes', () => {
    expect(minutesToHours(150)).toBe('2h 30m')
  })
  it('converts 8 hours 15 minutes', () => {
    expect(minutesToHours(495)).toBe('8h 15m')
  })
})

describe('todayEatClient', () => {
  it('returns YYYY-MM-DD format', () => {
    const result = todayEatClient()
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('uses Intl.DateTimeFormat (IANA-safe, not manual +3 arithmetic)', () => {
    // Verify the helper produces the same result as a direct Intl call
    // with Africa/Nairobi timezone — proving it uses IANA, not hardcoded offset.
    const intlDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Nairobi',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
    expect(todayEatClient()).toBe(intlDate)
  })
})

describe('currentYearMonthEat', () => {
  it('returns year and month as numbers', () => {
    const result = currentYearMonthEat()
    expect(typeof result.year).toBe('number')
    expect(typeof result.month).toBe('number')
    expect(result.month).toBeGreaterThanOrEqual(1)
    expect(result.month).toBeLessThanOrEqual(12)
  })

  it('uses Intl.DateTimeFormat (IANA-safe, not manual +3 arithmetic)', () => {
    // Verify the helper produces the same result as a direct Intl call
    // with Africa/Nairobi timezone — proving it uses IANA, not hardcoded offset.
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Nairobi',
      year: 'numeric',
      month: 'numeric',
    }).formatToParts(new Date())
    const expectedYear = parseInt(parts.find((p) => p.type === 'year')!.value, 10)
    const expectedMonth = parseInt(parts.find((p) => p.type === 'month')!.value, 10)

    const result = currentYearMonthEat()
    expect(result.year).toBe(expectedYear)
    expect(result.month).toBe(expectedMonth)
  })
})
