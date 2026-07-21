import { describe, it, expect } from 'vitest'

/**
 * Calendar date parsing tests.
 *
 * These test the date normalization patterns used in CalendarPage.tsx.
 * The RPC returns dates as YYYY-MM-DD strings, but they could also be
 * Date objects depending on the Supabase client serialization. The
 * CalendarPage normalizes them to YYYY-MM-DD strings for display and
 * comparison.
 */

// Patterns extracted from CalendarPage.tsx for explicit testing

/** Normalize a calendar date to a YYYY-MM-DD string */
function toDateStr(date: string | Date | null | undefined): string | null {
  if (!date) return null
  if (date instanceof Date) return date.toISOString().slice(0, 10)
  const str = String(date).slice(0, 10)
  // Validate it's a plausible date string
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return null
  return str
}

/** Extract the day number from a YYYY-MM-DD string */
function toDayNum(dateStr: string | null): number | null {
  if (!dateStr) return null
  const n = parseInt(dateStr.slice(8, 10), 10)
  return isNaN(n) ? null : n
}

/** Check if a date string represents a past or current date */
function isPastOrToday(dateStr: string | null, today: string): boolean {
  if (!dateStr) return false
  return dateStr <= today
}

describe('toDateStr — date normalization', () => {
  it('returns null for null input', () => {
    expect(toDateStr(null)).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(toDateStr(undefined)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(toDateStr('')).toBeNull()
  })

  it('keeps a valid YYYY-MM-DD string unchanged', () => {
    expect(toDateStr('2026-07-21')).toBe('2026-07-21')
  })

  it('truncates a longer string to YYYY-MM-DD', () => {
    expect(toDateStr('2026-07-21T12:00:00Z')).toBe('2026-07-21')
  })

  it('handles date string with trailing space', () => {
    expect(toDateStr('2026-07-21 ')).toBe('2026-07-21')
  })

  it('returns null for invalid date format', () => {
    expect(toDateStr('not-a-date')).toBeNull()
  })

  it('returns null for random string', () => {
    expect(toDateStr('foo')).toBeNull()
  })

  it('converts a Date object to YYYY-MM-DD', () => {
    // Use UTC-midnight date to avoid timezone offset shifting the day
    const d = new Date('2026-07-21T12:00:00Z')
    expect(toDateStr(d)).toBe('2026-07-21')
  })

  it('handles Date object at midnight UTC', () => {
    const d = new Date('2026-12-25T00:00:00Z')
    expect(toDateStr(d)).toBe('2026-12-25')
  })

  it('handles Date object in different timezone', () => {
    const d = new Date('2026-01-01T23:00:00-05:00')
    // toISOString gives UTC, so Jan 2 04:00:00Z → slice(0,10) = '2026-01-02'
    expect(toDateStr(d)).toBe('2026-01-02')
  })

  it('handles first day of month', () => {
    expect(toDateStr('2026-01-01')).toBe('2026-01-01')
    const d = new Date('2026-01-01T12:00:00Z')
    expect(toDateStr(d)).toBe('2026-01-01')
  })

  it('handles last day of year', () => {
    expect(toDateStr('2026-12-31')).toBe('2026-12-31')
  })
})

describe('toDayNum — day number extraction', () => {
  it('returns null for null input', () => {
    expect(toDayNum(null)).toBeNull()
  })

  it('returns day number for valid date string', () => {
    expect(toDayNum('2026-07-21')).toBe(21)
  })

  it('returns 1 for first day of month', () => {
    expect(toDayNum('2026-07-01')).toBe(1)
  })

  it('returns 31 for last day of month', () => {
    expect(toDayNum('2026-07-31')).toBe(31)
  })

  it('handles single-digit day with leading zero', () => {
    expect(toDayNum('2026-07-05')).toBe(5)
  })

  it('extracts correctly from longer timestamp string', () => {
    expect(toDayNum('2026-07-15T12:00:00Z'.slice(0, 10))).toBe(15)
  })

  it('returns NaN for invalid string that passes slice', () => {
    const invalid = '2026-07-xx'.slice(0, 10)
    expect(parseInt(invalid.slice(8, 10), 10)).toBeNaN()
  })
})

describe('isPastOrToday — date comparison', () => {
  const today = '2026-07-21'

  it('returns false for null date', () => {
    expect(isPastOrToday(null, today)).toBe(false)
  })

  it('returns false for future date', () => {
    expect(isPastOrToday('2026-07-25', today)).toBe(false)
  })

  it('returns true for today', () => {
    expect(isPastOrToday('2026-07-21', today)).toBe(true)
  })

  it('returns true for yesterday', () => {
    expect(isPastOrToday('2026-07-20', today)).toBe(true)
  })

  it('returns true for past month', () => {
    expect(isPastOrToday('2026-06-15', today)).toBe(true)
  })

  it('returns true for past year', () => {
    expect(isPastOrToday('2025-12-01', today)).toBe(true)
  })

  it('compares lexicographically correctly for ISO dates', () => {
    // ISO date strings sort lexicographically which matches chronological order
    const dates = ['2026-01-01', '2026-06-15', '2026-07-21', '2026-12-31']
    const sorted = [...dates].sort()
    expect(sorted).toEqual(dates)
  })

  it('works at month boundaries', () => {
    expect(isPastOrToday('2026-06-30', '2026-07-01')).toBe(true)
    expect(isPastOrToday('2026-07-01', '2026-06-30')).toBe(false)
  })

  it('works at year boundaries', () => {
    expect(isPastOrToday('2025-12-31', '2026-01-01')).toBe(true)
    expect(isPastOrToday('2026-01-01', '2025-12-31')).toBe(false)
  })
})

describe('CalendarDay type guard — present rate calculation', () => {
  // This tests the pattern used in CalendarPage to calculate present rate
  it('calculates present rate from day stats', () => {
    const calendar = [
      { present: 15, late: 3, absent: 2, total: 20 },
      { present: 18, late: 1, absent: 1, total: 20 },
      { present: 0, late: 0, absent: 20, total: 20 },
    ]

    const totalPresentLate = calendar.reduce((s, d) => s + d.present + d.late, 0)
    const totalPresent = calendar.reduce((s, d) => s + d.present, 0)
    const totalLate = calendar.reduce((s, d) => s + d.late, 0)
    const totalAbsent = calendar.reduce((s, d) => s + d.absent, 0)

    expect(totalPresent).toBe(33)
    expect(totalLate).toBe(4)
    expect(totalAbsent).toBe(23)
    expect(totalPresentLate).toBe(37)

    // Attendance rate calculation (as in CalendarPage)
    const totalEnrolled = 20 * 3 // 3 days * 20 teachers
    const rate = totalEnrolled > 0 ? Math.round((totalPresentLate / totalEnrolled) * 100) : 0
    expect(rate).toBe(62)
  })

  it('handles zero total to avoid division by zero', () => {
    const totalEnrolled = 0
    const totalPresentLate = 0
    const rate = totalEnrolled > 0 ? Math.round((totalPresentLate / totalEnrolled) * 100) : 0
    expect(rate).toBe(0)
  })
})

describe('DayAttendance summary — attendance rate', () => {
  // This tests the pattern used in getDayAttendanceDetail
  it('calculates attendance rate from records', () => {
    const records = [
      { status: 'present' },
      { status: 'present' },
      { status: 'late' },
      { status: 'absent' },
    ]

    const present = records.filter(r => ['present', 'checked_out'].includes(r.status)).length
    const late = records.filter(r => r.status === 'late').length
    const absent = records.filter(r => r.status === 'absent').length
    const total = records.length
    const rate = total > 0 ? Math.round(((present + late) / total) * 100) : 0

    expect(present).toBe(2)
    expect(late).toBe(1)
    expect(absent).toBe(1)
    expect(total).toBe(4)
    expect(rate).toBe(75)
  })

  it('handles empty records', () => {
    const records: { status: string }[] = []
    const total = records.length
    const rate = total > 0 ? Math.round(((0 + 0) / total) * 100) : 0
    expect(rate).toBe(0)
  })

  it('includes checked_out in present count', () => {
    const records = [
      { status: 'checked_out' },
      { status: 'present' },
      { status: 'absent' },
    ]
    const present = records.filter(r => ['present', 'checked_out'].includes(r.status)).length
    expect(present).toBe(2)
  })
})
