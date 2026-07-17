import { useState, useRef, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { checkInWithLocation, type CheckInWithLocationResult } from '@/services/attendance'
import { captureGpsPosition } from '@/services/location'
import { getDeviceInfo } from '@/lib/device'
import {
  AlreadyCheckedInError,
  GpsDeniedError,
  GpsUnavailableError,
  GpsTimeoutError,
  LocationRejectedError,
  LowAccuracyError,
} from '@/lib/errors'

export interface UseLocationAttendanceState {
  checkingIn: boolean
  error: string | null
  distance: number | null
  locationStatus: 'inside_school' | 'outside_school' | 'low_accuracy' | null
  gpsAccuracy: number | null
  successMessage: string | null
}

export interface UseLocationAttendanceReturn extends UseLocationAttendanceState {
  checkIn: () => Promise<CheckInWithLocationResult | null>
  clearError: () => void
  clearSuccess: () => void
}

const attendanceKeys = {
  today: (teacherId: string) => ['attendance', 'today', teacherId] as const,
  summary: (teacherId: string, year: number, month: number) =>
    ['attendance', 'summary', teacherId, year, month] as const,
}

export function useLocationAttendance(): UseLocationAttendanceReturn {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const submittingRef = useRef(false)

  const [state, setState] = useState<UseLocationAttendanceState>({
    checkingIn: false,
    error: null,
    distance: null,
    locationStatus: null,
    gpsAccuracy: null,
    successMessage: null,
  })

  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }))
  }, [])

  const clearSuccess = useCallback(() => {
    setState((prev) => ({ ...prev, successMessage: null }))
  }, [])

  const checkIn = useCallback(async (): Promise<CheckInWithLocationResult | null> => {
    const teacher = user?.teacher
    const teacherId = teacher?.id

    if (!teacherId || submittingRef.current) return null

    submittingRef.current = true
    setState((prev) => ({
      ...prev,
      checkingIn: true,
      error: null,
      successMessage: null,
      distance: null,
      locationStatus: null,
    }))

    try {
      const gps = await captureGpsPosition()
      const { device, browser } = getDeviceInfo()

      const result = await checkInWithLocation(
        teacherId,
        gps.latitude,
        gps.longitude,
        device,
        browser,
        gps.accuracy
      )

      if (!result.success) {
        if (result.location_status === 'low_accuracy') {
          throw new LowAccuracyError(result.accuracy ?? gps.accuracy)
        }
        if (result.location_status === 'outside_school') {
          throw new LocationRejectedError(result.distance ?? 0, 100)
        }
        throw new Error(result.message ?? result.error ?? 'Check-in failed')
      }

      setState((prev) => ({
        ...prev,
        checkingIn: false,
        distance: result.distance ?? null,
        locationStatus: (result.location_status as 'inside_school') ?? null,
        gpsAccuracy: gps.accuracy,
        successMessage: 'Check-in successful!',
      }))

      queryClient.invalidateQueries({ queryKey: attendanceKeys.today(teacherId) })
      const now = new Date()
      queryClient.invalidateQueries({
        queryKey: attendanceKeys.summary(teacherId, now.getFullYear(), now.getMonth() + 1),
      })

      return result
    } catch (err) {
      let message: string
      if (err instanceof AlreadyCheckedInError) {
        message = err.message
      } else if (err instanceof GpsDeniedError) {
        message = err.message
      } else if (err instanceof GpsUnavailableError) {
        message = err.message
      } else if (err instanceof GpsTimeoutError) {
        message = err.message
      } else if (err instanceof LowAccuracyError) {
        message = err.message
      } else if (err instanceof LocationRejectedError) {
        message = err.message
      } else if (err instanceof Error) {
        message = err.message
      } else {
        message = 'Something went wrong. Please try again.'
      }

      setState((prev) => ({
        ...prev,
        checkingIn: false,
        error: message,
      }))

      return null
    } finally {
      submittingRef.current = false
    }
  }, [user, queryClient])

  return { ...state, checkIn, clearError, clearSuccess }
}
