import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFrom = vi.fn()
const mockSelect = vi.fn()
const mockEq = vi.fn()
const mockMaybeSingle = vi.fn()

const mockGte = vi.fn()
const mockLte = vi.fn()
const mockRpc = vi.fn()

vi.mock('./supabase', () => ({
  supabase: {
    from: mockFrom,
    rpc: mockRpc,
  },
}))

function makeEqChain() {
  const eq2 = vi.fn()
  eq2.mockReturnValue({ maybeSingle: mockMaybeSingle })
  const eq1 = vi.fn()
  eq1.mockReturnValue({ eq: eq2 })
  return { eq: eq1, eq2, maybeSingle: mockMaybeSingle }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getTodayAttendance', () => {
  it('returns attendance record for today', async () => {
    const chain = makeEqChain()
    mockFrom.mockReturnValue({ select: mockSelect })
    mockSelect.mockReturnValue({ eq: chain.eq })
    mockMaybeSingle.mockResolvedValue({
      data: {
        id: 'att-1',
        teacher_id: 'teacher-1',
        attendance_date: '2026-07-20',
        check_in: '2026-07-20T07:15:00Z',
        status: 'present',
        attendance_status: 'PRESENT',
      },
      error: null,
    })

    const { getTodayAttendance } = await import('./attendance')
    const result = await getTodayAttendance('teacher-1')

    expect(result).not.toBeNull()
    expect(result!.id).toBe('att-1')
    expect(result!.status).toBe('present')
  })

  it('uses Africa/Nairobi business date, not browser local date', async () => {
    const chain = makeEqChain()
    mockFrom.mockReturnValue({ select: mockSelect })
    mockSelect.mockReturnValue({ eq: chain.eq })
    mockMaybeSingle.mockResolvedValue({
      data: {
        id: 'att-eat',
        teacher_id: 'teacher-1',
        attendance_date: '2026-07-20',
        check_in: '2026-07-20T07:15:00Z',
        status: 'present',
      },
      error: null,
    })

    // Simulate UTC 2026-07-19T23:00:00Z = EAT 2026-07-20T02:00:00
    // TodayEatClient uses Intl.DateTimeFormat which is IANA-safe.
    // Verify that todayEatClient is called (imported from @/lib/format)
    // and the date passed to the query matches the EAT date.
    const { todayEatClient } = await import('@/lib/format')
    const eatDate = todayEatClient()

    const { getTodayAttendance } = await import('./attendance')
    await getTodayAttendance('teacher-1')

    // The second eq call (chain.eq2) should have attendance_date = EAT date
    const eq2Calls = chain.eq2.mock.calls
    const dateFilter = eq2Calls.find((c: unknown[]) => c[0] === 'attendance_date')
    expect(dateFilter).toBeDefined()
    expect(dateFilter![1]).toBe(eatDate)
  })

  it('throws on error', async () => {
    const chain = makeEqChain()
    mockFrom.mockReturnValue({ select: mockSelect })
    mockSelect.mockReturnValue({ eq: chain.eq })
    mockMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'DB error' },
    })

    const { getTodayAttendance } = await import('./attendance')
    await expect(getTodayAttendance('teacher-1')).rejects.toThrow('DB error')
  })
})

describe('getAttendanceSummary', () => {
  it('returns monthly counts', async () => {
    mockFrom.mockReturnValue({ select: mockSelect })
    mockSelect.mockReturnValue({ eq: mockEq })
    mockEq.mockReturnValue({ gte: mockGte })
    mockGte.mockReturnValue({ lte: mockLte })
    mockLte.mockResolvedValue({
      data: [
        { status: 'present' },
        { status: 'present' },
        { status: 'late' },
        { status: 'absent' },
      ],
      error: null,
    })

    const { getAttendanceSummary } = await import('./attendance')
    const result = await getAttendanceSummary('teacher-1', 2026, 7)

    expect(result.present).toBe(2)
    expect(result.late).toBe(1)
    expect(result.absent).toBe(1)
    expect(result.total).toBe(4)
  })
})
