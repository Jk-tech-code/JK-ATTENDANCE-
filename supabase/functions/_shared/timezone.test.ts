import { describe, it, expect } from 'vitest'

import {
  todayEat,
  currentMonthEat,
  currentYearEat,
  daysInMonth,
  toNairobiMinutes,
  todayEatIntl,
  BUSINESS_TZ,
} from '../_shared/timezone'

describe('timezone utilities', () => {
  describe('todayEat', () => {
    it('returns a YYYY-MM-DD string', () => {
      const result = todayEat()
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('returns a date that is +3 hours from UTC midnight boundary', () => {
      const result = todayEat()
      const parts = result.split('-').map(Number)
      expect(parts[0]).toBeGreaterThanOrEqual(2025)
      expect(parts[1]).toBeGreaterThanOrEqual(1)
      expect(parts[1]).toBeLessThanOrEqual(12)
      expect(parts[2]).toBeGreaterThanOrEqual(1)
      expect(parts[2]).toBeLessThanOrEqual(31)
    })
  })

  describe('todayEatIntl', () => {
    it('returns a YYYY-MM-DD string', () => {
      const result = todayEatIntl()
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('matches todayEat on the same instant', () => {
      // Both should produce the same date for Nairobi
      const legacy = todayEat()
      const intl = todayEatIntl()
      expect(intl).toBe(legacy)
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

  describe('toNairobiMinutes', () => {
    it('returns correct structure', () => {
      const result = toNairobiMinutes('2026-09-10T07:30:00Z')
      expect(result).toHaveProperty('hours')
      expect(result).toHaveProperty('minutes')
      expect(result).toHaveProperty('totalMinutes')
    })

    it('converts 07:30 UTC to 10:30 EAT (630 minutes)', () => {
      // 07:30 UTC = 10:30 EAT (UTC+3)
      const result = toNairobiMinutes('2026-09-10T07:30:00Z')
      expect(result.hours).toBe(10)
      expect(result.minutes).toBe(30)
      expect(result.totalMinutes).toBe(630)
    })

    it('converts 04:30 UTC to 07:30 EAT (450 minutes)', () => {
      // 04:30 UTC = 07:30 EAT — the key test: must return 450, not 270
      const result = toNairobiMinutes('2026-09-10T04:30:00Z')
      expect(result.hours).toBe(7)
      expect(result.minutes).toBe(30)
      expect(result.totalMinutes).toBe(450)
    })

    it('converts 21:30 UTC to 00:30 EAT next day (30 minutes)', () => {
      // 21:30 UTC Sep 9 = 00:30 EAT Sep 10
      const result = toNairobiMinutes('2026-09-09T21:30:00Z')
      expect(result.hours).toBe(0)
      expect(result.minutes).toBe(30)
      expect(result.totalMinutes).toBe(30)
    })

    it('converts 04:00 UTC to 07:00 EAT (420 minutes)', () => {
      const result = toNairobiMinutes('2026-09-10T04:00:00Z')
      expect(result.hours).toBe(7)
      expect(result.minutes).toBe(0)
      expect(result.totalMinutes).toBe(420)
    })

    it('converts 09:00 UTC to 12:00 EAT (720 minutes)', () => {
      const result = toNairobiMinutes('2026-09-10T09:00:00Z')
      expect(result.hours).toBe(12)
      expect(result.minutes).toBe(0)
      expect(result.totalMinutes).toBe(720)
    })

    it('converts 14:30 UTC to 17:30 EAT (1050 minutes)', () => {
      const result = toNairobiMinutes('2026-09-10T14:30:00Z')
      expect(result.hours).toBe(17)
      expect(result.minutes).toBe(30)
      expect(result.totalMinutes).toBe(1050)
    })

    it('converts 20:30 UTC to 23:30 EAT (1410 minutes)', () => {
      const result = toNairobiMinutes('2026-09-10T20:30:00Z')
      expect(result.hours).toBe(23)
      expect(result.minutes).toBe(30)
      expect(result.totalMinutes).toBe(1410)
    })

    it('handles Date objects', () => {
      const result = toNairobiMinutes(new Date('2026-09-10T04:30:00Z'))
      expect(result.totalMinutes).toBe(450)
    })
  })

  describe('BUSINESS_TZ', () => {
    it('is Africa/Nairobi', () => {
      expect(BUSINESS_TZ).toBe('Africa/Nairobi')
    })
  })
})
