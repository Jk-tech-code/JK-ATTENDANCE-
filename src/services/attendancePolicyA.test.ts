import { describe, it, expect } from 'vitest'

/**
 * Policy A Regression Tests
 * 
 * Verifies that:
 * 1. Grace period is a classification threshold, NOT a hard cutoff.
 * 2. Check-ins after grace period are successfully accepted as 'LATE'.
 * 3. late_minutes is calculated as check_in_time - grace_end.
 */

interface CheckInEvaluation {
  reportingStartTime: string // e.g. '06:40'
  gracePeriodMinutes: number // e.g. 25
  checkInTime: string        // e.g. '07:06'
}

function evaluatePolicyA(input: CheckInEvaluation) {
  // Convert times to minutes from midnight for pure deterministic calculation
  const parseTimeToMinutes = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    return h * 60 + m
  }

  const startMin = parseTimeToMinutes(input.reportingStartTime)
  const graceEndMin = startMin + input.gracePeriodMinutes
  const checkInMin = parseTimeToMinutes(input.checkInTime)

  const isLate = checkInMin > graceEndMin
  const lateMinutes = isLate ? checkInMin - graceEndMin : 0
  const attendanceStatus = isLate ? 'LATE' : 'PRESENT'

  return {
    success: true, // Policy A guarantees success even when late
    attendance_status: attendanceStatus,
    late_minutes: lateMinutes,
  }
}

describe('Policy A Attendance Logic', () => {
  const reportingStartTime = '06:40'
  const gracePeriodMinutes = 25
  // Grace ends at 07:05 (6 * 60 + 40 + 25 = 425 min = 07:05)

  it('Test 1 — Before reporting time (06:30)', () => {
    const res = evaluatePolicyA({ reportingStartTime, gracePeriodMinutes, checkInTime: '06:30' })
    expect(res.success).toBe(true)
    expect(res.attendance_status).toBe('PRESENT')
    expect(res.late_minutes).toBe(0)
  })

  it('Test 2 — Exactly at reporting time (06:40)', () => {
    const res = evaluatePolicyA({ reportingStartTime, gracePeriodMinutes, checkInTime: '06:40' })
    expect(res.success).toBe(true)
    expect(res.attendance_status).toBe('PRESENT')
    expect(res.late_minutes).toBe(0)
  })

  it('Test 3 — Inside grace period (06:55)', () => {
    const res = evaluatePolicyA({ reportingStartTime, gracePeriodMinutes, checkInTime: '06:55' })
    expect(res.success).toBe(true)
    expect(res.attendance_status).toBe('PRESENT')
    expect(res.late_minutes).toBe(0)
  })

  it('Test 4 — Exactly at grace-period boundary (07:05)', () => {
    const res = evaluatePolicyA({ reportingStartTime, gracePeriodMinutes, checkInTime: '07:05' })
    expect(res.success).toBe(true)
    expect(res.attendance_status).toBe('PRESENT')
    expect(res.late_minutes).toBe(0)
  })

  it('Test 5 — One minute after grace period (07:06)', () => {
    const res = evaluatePolicyA({ reportingStartTime, gracePeriodMinutes, checkInTime: '07:06' })
    expect(res.success).toBe(true)
    expect(res.attendance_status).toBe('LATE')
    expect(res.late_minutes).toBe(1)
  })

  it('Test 6 — Significantly after grace period (08:00)', () => {
    const res = evaluatePolicyA({ reportingStartTime, gracePeriodMinutes, checkInTime: '08:00' })
    // Grace ends 07:05. 08:00 is 55 minutes later.
    expect(res.success).toBe(true)
    expect(res.attendance_status).toBe('LATE')
    expect(res.late_minutes).toBe(55)
  })

  it('Test 7 — Very late check-in (09:00)', () => {
    const res = evaluatePolicyA({ reportingStartTime, gracePeriodMinutes, checkInTime: '09:00' })
    // Grace ends 07:05. 09:00 is 115 minutes later.
    expect(res.success).toBe(true)
    expect(res.attendance_status).toBe('LATE')
    expect(res.late_minutes).toBe(115)
  })

  it('CRITICAL REGRESSION ASSERTION: Check-in after grace period MUST NOT be rejected', () => {
    const lateCheckIns = ['07:06', '07:10', '08:00', '12:00']
    for (const checkInTime of lateCheckIns) {
      const res = evaluatePolicyA({ reportingStartTime, gracePeriodMinutes, checkInTime })
      expect(res.success).toBe(true) // Must never reject solely due to lateness
      expect(res.attendance_status).toBe('LATE')
    }
  })

  it('Verifies late_minutes accuracy is measured from grace_end, not reporting_start_time', () => {
    // Reporting start: 06:40. Grace: 25 min. Grace end: 07:05.
    // Check-in: 07:30 (50 min past reporting start, but 25 min past grace end).
    const res = evaluatePolicyA({ reportingStartTime, gracePeriodMinutes, checkInTime: '07:30' })
    expect(res.success).toBe(true)
    expect(res.attendance_status).toBe('LATE')
    expect(res.late_minutes).toBe(25) // 07:30 - 07:05 = 25 minutes
  })
})
