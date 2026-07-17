import { supabase } from './supabase'
import type { Attendance } from '@/types'
import { formatISODate } from '@/lib/format'
import {
  AlreadyCheckedInError,
  AlreadyCheckedOutError,
  NoAttendanceRecordError,
  UndoWindowExpiredError,
} from '@/lib/errors'

export interface CheckInWithLocationResult {
  success: boolean
  status?: string
  location_status?: string
  distance?: number
  accuracy?: number
  id?: string
  error?: string
  message?: string
}

export async function getTodayAttendance(
  teacherId: string
): Promise<Attendance | null> {
  const today = formatISODate(new Date())
  const { data, error } = await supabase
    .from('attendance')
    .select('*')
    .eq('teacher_id', teacherId)
    .eq('attendance_date', today)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data as Attendance | null
}

export async function checkInWithLocation(
  teacherId: string,
  latitude: number,
  longitude: number,
  device: string,
  browser: string,
  accuracy: number
): Promise<CheckInWithLocationResult> {
  const { data, error } = await supabase.rpc('check_in_with_location', {
    p_teacher_id: teacherId,
    p_latitude: latitude,
    p_longitude: longitude,
    p_device: device,
    p_browser: browser,
    p_accuracy: accuracy,
  })

  if (error) throw new Error(error.message)

  const result = data as CheckInWithLocationResult

  if (!result.success && result.error === 'already_checked_in') {
    throw new AlreadyCheckedInError()
  }

  return result
}

export async function checkOut(attendanceId: string): Promise<Attendance> {
  const { data, error } = await supabase.rpc('check_out', {
    p_attendance_id: attendanceId,
  })

  if (error) throw new Error(error.message)

  const result = data as Record<string, unknown>

  if (result.error === 'not_found') {
    throw new NoAttendanceRecordError()
  }
  if (result.error === 'not_checked_in') {
    throw new Error('You have not checked in yet.')
  }
  if (result.error === 'already_checked_out') {
    throw new AlreadyCheckedOutError()
  }

  return result as unknown as Attendance
}

export async function undoCheckOut(attendanceId: string): Promise<Attendance> {
  const { data, error } = await supabase.rpc('undo_check_out', {
    p_attendance_id: attendanceId,
  })

  if (error) throw new Error(error.message)

  const result = data as Record<string, unknown>

  if (result.error === 'not_found') {
    throw new NoAttendanceRecordError()
  }
  if (result.error === 'not_checked_out') {
    throw new Error('You have not checked out yet.')
  }
  if (result.error === 'undo_window_expired') {
    throw new UndoWindowExpiredError()
  }

  return result as unknown as Attendance
}

export async function getAttendanceSummary(
  teacherId: string,
  year: number,
  month: number
): Promise<{ total: number; present: number; late: number; absent: number; checkedOut: number }> {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  const endDate = new Date(year, month, 0).toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('attendance')
    .select('status')
    .eq('teacher_id', teacherId)
    .gte('attendance_date', startDate)
    .lte('attendance_date', endDate)

  if (error) throw new Error(error.message)

  const records = (data || []) as { status: string | null }[]
  return {
    total: records.length,
    present: records.filter((r) => r.status === 'present').length,
    late: records.filter((r) => r.status === 'late').length,
    absent: records.filter((r) => r.status === 'absent').length,
    checkedOut: records.filter((r) => r.status === 'checked_out').length,
  }
}
