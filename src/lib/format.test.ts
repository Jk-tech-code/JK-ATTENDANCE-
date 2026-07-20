import { describe, it, expect } from 'vitest'
import { formatDate, formatTime, formatISODate, minutesToHours } from './format'

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
