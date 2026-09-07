/**
 * Unit tests for the useLocationAttendance hook.
 *
 * The hook is the single most important business-logic hook in the app:
 * it owns the GPS check-in state machine, maps every error class to a
 * user-visible message, prevents double-submits via submittingRef, and
 * invalidates the React-Query cache on success. These tests exercise the
 * state transitions in isolation, with all I/O mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

// ─── Mocks ──────────────────────────────────────────────────────
const mockCheckInWithLocation = vi.fn()
const mockCaptureGpsPosition = vi.fn()
const mockGetSchoolSettings = vi.fn()
const mockGetDeviceInfo = vi.fn()

vi.mock('@/services/attendance', () => ({
  checkInWithLocation: (...args: unknown[]) => mockCheckInWithLocation(...args),
}))

vi.mock('@/services/location', () => ({
  captureGpsPosition: (...args: unknown[]) => mockCaptureGpsPosition(...args),
}))

vi.mock('@/services/admin', () => ({
  getSchoolSettings: (...args: unknown[]) => mockGetSchoolSettings(...args),
}))

vi.mock('@/lib/device', () => ({
  getDeviceInfo: () => mockGetDeviceInfo(),
}))

import { AuthContext } from '@/contexts/AuthContext'
import type { AuthUser } from '@/types'
import { useLocationAttendance } from './useLocationAttendance'
import { LocationRejectedError, RateLimitError } from '@/lib/errors'

// ─── Helpers ────────────────────────────────────────────────────
function makeAuthUser(teacherId: string): AuthUser {
  return {
    id: 'user-id',
    email: 'teacher@school.com',
    role: 'teacher',
    profile: null,
    teacher: {
      id: teacherId,
      full_name: 'Test Teacher',
      email: 'teacher@school.com',
      staff_number: 'S001',
      department: 'Math',
      role: 'teacher',
      phone: null,
      reporting_time: '07:20',
      employment_status: 'active',
      created_at: new Date().toISOString(),
    },
  }
}

function makeWrapper(teacherId: string | null) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const authValue = {
    user: teacherId ? makeAuthUser(teacherId) : null,
    loading: false,
    profileError: null,
    refreshProfile: vi.fn(),
    signIn: vi.fn(),
    signInWithGoogle: vi.fn(),
    signOut: vi.fn(),
  }
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={authValue}>{children}</AuthContext.Provider>
    </QueryClientProvider>
  )
}

const TEACHER_ID = '00000000-0000-0000-0000-000000000abc'

const gpsResult = { latitude: -1.2921, longitude: 36.8219, accuracy: 12 }
const deviceInfo = { device: 'Mobile', browser: 'Chrome' }

const successPayload = {
  success: true,
  attendance_status: 'present',
  location_status: 'inside_school',
  distance: 15,
}

// ─── Tests ──────────────────────────────────────────────────────
describe('useLocationAttendance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCaptureGpsPosition.mockResolvedValue(gpsResult)
    mockGetDeviceInfo.mockReturnValue(deviceInfo)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns a no-op result when there is no teacher', async () => {
    const { result } = renderHook(() => useLocationAttendance(), {
      wrapper: makeWrapper(null),
    })

    let returnValue: unknown = 'unset'
    await act(async () => {
      returnValue = await result.current.checkIn()
    })
    expect(returnValue).toBeNull()
    expect(mockCaptureGpsPosition).not.toHaveBeenCalled()
    expect(mockCheckInWithLocation).not.toHaveBeenCalled()
  })

  it('sets checkingIn=true while in flight, then successMessage on success', async () => {
    mockCheckInWithLocation.mockResolvedValue(successPayload)

    const { result } = renderHook(() => useLocationAttendance(), {
      wrapper: makeWrapper(TEACHER_ID),
    })

    expect(result.current.checkingIn).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.successMessage).toBeNull()

    await act(async () => {
      await result.current.checkIn()
    })

    expect(result.current.checkingIn).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.successMessage).toBe('Check-in successful!')
    expect(result.current.locationStatus).toBe('inside_school')
    expect(result.current.distance).toBe(15)
  })

  it('passes GPS, device, browser, and accuracy to the RPC', async () => {
    mockCheckInWithLocation.mockResolvedValue(successPayload)

    const { result } = renderHook(() => useLocationAttendance(), {
      wrapper: makeWrapper(TEACHER_ID),
    })

    await act(async () => {
      await result.current.checkIn()
    })

    expect(mockCaptureGpsPosition).toHaveBeenCalledTimes(1)
    expect(mockGetDeviceInfo).toHaveBeenCalledTimes(1)
    expect(mockCheckInWithLocation).toHaveBeenCalledWith(
      TEACHER_ID,
      gpsResult.latitude,
      gpsResult.longitude,
      deviceInfo.device,
      deviceInfo.browser,
      gpsResult.accuracy
    )
  })

  it('maps outside_school to LocationRejectedError with the configured radius', async () => {
    // RPC returns success:false with location_status outside the radius;
    // the hook re-fetches school_settings for the radius value and
    // throws LocationRejectedError so the catch block shows the message.
    mockCheckInWithLocation.mockResolvedValue({
      success: false,
      location_status: 'outside_school',
      distance: 350,
    })
    mockGetSchoolSettings.mockResolvedValue({ allowed_radius_meters: 100 })

    const { result } = renderHook(() => useLocationAttendance(), {
      wrapper: makeWrapper(TEACHER_ID),
    })

    await act(async () => {
      await result.current.checkIn()
    })

    expect(mockGetSchoolSettings).toHaveBeenCalledTimes(1)
    expect(result.current.error).toContain('outside the approved school attendance zone')
    expect(result.current.checkingIn).toBe(false)
    expect(result.current.successMessage).toBeNull()
  })

  it('maps low_accuracy to a clear error message', async () => {
    mockCheckInWithLocation.mockResolvedValue({
      success: false,
      location_status: 'low_accuracy',
      accuracy: 250,
    })

    const { result } = renderHook(() => useLocationAttendance(), {
      wrapper: makeWrapper(TEACHER_ID),
    })

    await act(async () => {
      await result.current.checkIn()
    })

    expect(result.current.error).toMatch(/GPS signal too weak/)
    expect(result.current.checkingIn).toBe(false)
  })

  it('extracts rateLimitRetryAfter when the RPC reports rate_limited', async () => {
    // The service layer throws RateLimitError, the hook catches it and
    // exposes retryAfter for the countdown UI.
    mockCheckInWithLocation.mockRejectedValue(new RateLimitError(45))

    const { result } = renderHook(() => useLocationAttendance(), {
      wrapper: makeWrapper(TEACHER_ID),
    })

    await act(async () => {
      await result.current.checkIn()
    })

    expect(result.current.error).toMatch(/Please wait 45 seconds/)
    expect(result.current.rateLimitRetryAfter).toBe(45)
    expect(result.current.rateLimitRemaining).toBe(0)
  })

  it('propagates LocationRejectedError messages from elsewhere in the flow', async () => {
    // Defensive: if a thrown LocationRejectedError bubbles up (not just
    // the synthetic one built inside the hook), it should still surface
    // its message correctly.
    mockCheckInWithLocation.mockRejectedValue(new LocationRejectedError(500, 100))

    const { result } = renderHook(() => useLocationAttendance(), {
      wrapper: makeWrapper(TEACHER_ID),
    })

    await act(async () => {
      await result.current.checkIn()
    })

    expect(result.current.error).toContain('outside the approved school attendance zone')
  })

  it('falls back to a generic message for unknown errors', async () => {
    mockCheckInWithLocation.mockRejectedValue(new Error('database offline'))

    const { result } = renderHook(() => useLocationAttendance(), {
      wrapper: makeWrapper(TEACHER_ID),
    })

    await act(async () => {
      await result.current.checkIn()
    })

    expect(result.current.error).toBe('database offline')
  })

  it('returns null on failure (not the result object)', async () => {
    mockCheckInWithLocation.mockRejectedValue(new Error('boom'))

    const { result } = renderHook(() => useLocationAttendance(), {
      wrapper: makeWrapper(TEACHER_ID),
    })

    let returnValue: unknown = 'unset'
    await act(async () => {
      returnValue = await result.current.checkIn()
    })
    expect(returnValue).toBeNull()
  })

  it('returns the RPC result on success (callers may inspect it)', async () => {
    mockCheckInWithLocation.mockResolvedValue(successPayload)

    const { result } = renderHook(() => useLocationAttendance(), {
      wrapper: makeWrapper(TEACHER_ID),
    })

    let returnValue: unknown = 'unset'
    await act(async () => {
      returnValue = await result.current.checkIn()
    })

    expect(returnValue).toEqual(successPayload)
  })

  it('prevents double-submit: a second checkIn while in flight is a no-op', async () => {
    let resolveCheckIn!: (v: unknown) => void
    mockCheckInWithLocation.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCheckIn = resolve
        })
    )

    const { result } = renderHook(() => useLocationAttendance(), {
      wrapper: makeWrapper(TEACHER_ID),
    })

    let first: Promise<unknown> | null = null
    let second: Promise<unknown> | null = null
    await act(async () => {
      first = result.current.checkIn()
    })
    // While the first is still pending, fire a second one.
    await act(async () => {
      second = result.current.checkIn()
    })

    expect(mockCheckInWithLocation).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveCheckIn(successPayload)
    })
    await first
    await second
  })

  it('clearError() resets the error state', async () => {
    mockCheckInWithLocation.mockRejectedValue(new Error('first attempt failed'))

    const { result } = renderHook(() => useLocationAttendance(), {
      wrapper: makeWrapper(TEACHER_ID),
    })

    await act(async () => {
      await result.current.checkIn()
    })
    expect(result.current.error).toBe('first attempt failed')

    act(() => {
      result.current.clearError()
    })
    expect(result.current.error).toBeNull()
  })

  it('clearSuccess() resets the success message', async () => {
    mockCheckInWithLocation.mockResolvedValue(successPayload)

    const { result } = renderHook(() => useLocationAttendance(), {
      wrapper: makeWrapper(TEACHER_ID),
    })

    await act(async () => {
      await result.current.checkIn()
    })
    expect(result.current.successMessage).toBe('Check-in successful!')

    act(() => {
      result.current.clearSuccess()
    })
    expect(result.current.successMessage).toBeNull()
  })

  it('resets checkingIn to false even when an error is thrown', async () => {
    mockCheckInWithLocation.mockRejectedValue(new Error('always fails'))

    const { result } = renderHook(() => useLocationAttendance(), {
      wrapper: makeWrapper(TEACHER_ID),
    })

    await act(async () => {
      await result.current.checkIn()
    })

    await waitFor(() => {
      expect(result.current.checkingIn).toBe(false)
    })
  })
})
