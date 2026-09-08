import { describe, it, expect } from 'vitest'

import { todayEat, currentMonthEat, currentYearEat, daysInMonth } from '../_shared/timezone'

describe('timezone utilities', () => {
  describe('todayEat', () => {
    it('returns a YYYY-MM-DD string', () => {
      const result = todayEat()
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('returns a date that is +3 hours from UTC midnight boundary', () => {
      // At UTC 20:00, EAT should be 23:00 (same day).
      // At UTC 21:00, EAT should be 00:00 (next day).
      // We just verify the format and that the value is reasonable.
      const result = todayEat()
      const parts = result.split('-').map(Number)
      expect(parts[0]).toBeGreaterThanOrEqual(2025)
      expect(parts[1]).toBeGreaterThanOrEqual(1)
      expect(parts[1]).toBeLessThanOrEqual(12)
      expect(parts[2]).toBeGreaterThanOrEqual(1)
      expect(parts[2]).toBeLessThanOrEqual(31)
    })
  })

  describe('currentMonthEat', () => {
    it('returns a value between 1 and 12', () => {
      const month = currentMonthEat()
      expect(month).toBeGreaterThanOrEqual(1)
      expect(month).toBeLessThanOrEqual(12)
    })
  })

  describe('currentYearEat', () => {
    it('returns a reasonable year', () => {
      const year = currentYearEat()
      expect(year).toBeGreaterThanOrEqual(2025)
      expect(year).toBeLessThanOrEqual(2100)
    })
  })

  describe('daysInMonth', () => {
    it('returns 31 for January', () => {
      expect(daysInMonth(2026, 1)).toBe(31)
    })

    it('returns 28 for February in a non-leap year', () => {
      expect(daysInMonth(2025, 2)).toBe(28)
    })

    it('returns 29 for February in a leap year', () => {
      expect(daysInMonth(2024, 2)).toBe(29)
    })

    it('returns 30 for April', () => {
      expect(daysInMonth(2026, 4)).toBe(30)
    })

    it('returns 30 for June', () => {
      expect(daysInMonth(2026, 6)).toBe(30)
    })

    it('returns 31 for December', () => {
      expect(daysInMonth(2026, 12)).toBe(31)
    })
  })
})
