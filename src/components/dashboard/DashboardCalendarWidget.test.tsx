import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const mockCheckDate = vi.fn()
const mockGetCalendarEntries = vi.fn()

vi.mock('@/services/calendar', () => ({
  checkDate: (...args: unknown[]) => mockCheckDate(...args),
  getCalendarEntries: (...args: unknown[]) => mockGetCalendarEntries(...args),
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

function futureDate(daysAhead: number): string {
  const d = new Date()
  d.setDate(d.getDate() + daysAhead)
  return d.toISOString().slice(0, 10)
}

describe('DashboardCalendarWidget', () => {
  it(
    'renders the date and next upcoming event when both queries succeed',
    { timeout: 15000 },
    async () => {
      mockCheckDate.mockResolvedValue({
        date: futureDate(0),
        day_type: 'working_day',
        title: 'Working Day',
        is_weekend: false,
        is_holiday: false,
        attendance_allowed: true,
      })
      mockGetCalendarEntries.mockResolvedValue([
        {
          id: '1',
          calendar_date: futureDate(15),
          day_type: 'holiday',
          title: 'Midterm Break',
          description: null,
          created_by: null,
          created_at: '2026-09-01T00:00:00Z',
        },
      ])

      const { DashboardCalendarWidget } = await import('./DashboardCalendarWidget')
      render(<DashboardCalendarWidget />)

      await waitFor(
        () => {
          expect(screen.getByText(/Working Day/i)).toBeInTheDocument()
        },
        { timeout: 10000 }
      )
      expect(screen.getByText(/Midterm Break/i)).toBeInTheDocument()
    }
  )

  it('does not crash the dashboard when checkDate fails', { timeout: 15000 }, async () => {
    mockCheckDate.mockRejectedValue(new Error('Access denied: admin role required'))
    mockGetCalendarEntries.mockResolvedValue([])

    const { DashboardCalendarWidget } = await import('./DashboardCalendarWidget')
    render(<DashboardCalendarWidget />)

    await waitFor(
      () => {
        expect(screen.getByText(/Calendar unavailable/i)).toBeInTheDocument()
      },
      { timeout: 10000 }
    )
  })

  it('does not crash the dashboard when getCalendarEntries fails', { timeout: 15000 }, async () => {
    mockCheckDate.mockResolvedValue({
      date: futureDate(0),
      day_type: 'working_day',
      title: 'Working Day',
      is_weekend: false,
      is_holiday: false,
      attendance_allowed: true,
    })
    mockGetCalendarEntries.mockRejectedValue(new Error('RLS denied'))

    const { DashboardCalendarWidget } = await import('./DashboardCalendarWidget')
    render(<DashboardCalendarWidget />)

    await waitFor(
      () => {
        expect(screen.getByText(/Working Day/i)).toBeInTheDocument()
      },
      { timeout: 10000 }
    )
  })

  it('handles empty entries gracefully', { timeout: 15000 }, async () => {
    mockCheckDate.mockResolvedValue({
      date: futureDate(0),
      day_type: 'working_day',
      title: 'Working Day',
      is_weekend: false,
      is_holiday: false,
      attendance_allowed: true,
    })
    mockGetCalendarEntries.mockResolvedValue([])

    const { DashboardCalendarWidget } = await import('./DashboardCalendarWidget')
    render(<DashboardCalendarWidget />)

    await waitFor(
      () => {
        expect(screen.getByText(/Working Day/i)).toBeInTheDocument()
      },
      { timeout: 10000 }
    )
  })
})
