import { supabase } from './supabase'

const EDGE_FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

async function getAuthToken(): Promise<string> {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw new Error('Failed to get session: ' + error.message)
  const token = data.session?.access_token
  if (!token) throw new Error('Session expired. Please log in again.')
  return token
}

async function callFunction<T>(
  name: string,
  options: {
    method?: 'GET' | 'POST'
    body?: unknown
    params?: Record<string, string>
  } = {}
): Promise<T> {
  const token = await getAuthToken()
  const url = new URL(`${EDGE_FUNCTIONS_URL}/${name}`)

  if (options.params) {
    Object.entries(options.params).forEach(([key, value]) => {
      url.searchParams.set(key, value)
    })
  }

  let response: Response
  try {
    response = await fetch(url.toString(), {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    })
  } catch (fetchErr) {
    const msg = (fetchErr as Error)?.message ?? ''
    if (
      msg.includes('Failed to fetch') ||
      msg.includes('NetworkError') ||
      msg.includes('network')
    ) {
      throw new Error(
        'Server unavailable. Check your internet connection or the function may not be deployed.'
      )
    }
    throw fetchErr as Error
  }

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({ error: response.statusText }))
    const statusMsg =
      response.status === 401
        ? 'Session expired. Please log in again.'
        : response.status === 403
          ? 'Permission denied. You do not have access to this resource.'
          : response.status === 404
            ? `Function not found. The edge function '${name}' may not be deployed.`
            : (errorBody.error ?? `Edge Function error: ${response.status}`)
    throw new Error(statusMsg)
  }

  return response.json()
}

// Note: there is intentionally no `recordAttendance()` helper here.
// All attendance writes go through the SECURITY DEFINER RPCs in
// src/services/attendance.ts (checkInWithLocation, checkOut,
// undoCheckOut), which enforce GPS validation, school-radius checks,
// and per-teacher rate limits. Migration 00048 locks down the
// attendance table to RPC-only writes (REVOKE INSERT/UPDATE/DELETE
// FROM authenticated, anon), and the record-attendance edge
// function that used to do raw table writes has been removed.
// See docs/adr/0002-remove-record-attendance.md for the full
// rationale and what to use instead.

export interface DailyReport {
  date: string
  present: number
  absent: number
  late: number
  checked_out: number
  total_teachers: number
  attendance_rate: number
  avg_check_in_time: string
  avg_working_minutes: number
}

export async function getDailyReportEdge(date?: string): Promise<DailyReport> {
  return callFunction<DailyReport>('daily-report', {
    params: date ? { date } : undefined,
  })
}

export interface TeacherMonthlyStats {
  teacher_id: string
  full_name: string
  staff_number: string
  total_days: number
  present: number
  late: number
  absent: number
  attendance_percentage: number
  avg_working_hours: number
}

export interface MonthlyReportResult {
  year: number
  month: number
  summary: {
    total_teachers: number
    working_days: number
    present_days: number
    late_days: number
    absent_days: number
    attendance_percentage: number
    avg_working_hours: number
  }
  teachers: TeacherMonthlyStats[]
}

export async function getMonthlyReportEdge(
  year?: number,
  month?: number
): Promise<MonthlyReportResult> {
  return callFunction<MonthlyReportResult>('monthly-report', {
    params: {
      ...(year ? { year: String(year) } : {}),
      ...(month ? { month: String(month) } : {}),
    },
  })
}

export interface VerifyAdminResult {
  verified: boolean
  user_id: string
  email: string
  role: string
  message: string
}

export async function verifyAdmin(): Promise<VerifyAdminResult> {
  return callFunction<VerifyAdminResult>('verify-admin')
}

export interface NotificationRecord {
  id: string
  teacher_id: string | null
  type: string
  message: string
  date: string
  channel: string
  status: string
  created_at?: string
}

export interface NotificationResult {
  success: boolean
  message: string
  notifications_created?: number
  teachers_notified?: Array<{ id: string; name: string; email: string }>
  notification?: NotificationRecord
}

export interface NotificationPayload {
  teacher_id?: string
  attendance_date?: string
  type: 'missed_check_in' | 'late_check_in' | 'absent' | 'reminder'
  custom_message?: string
}

export async function createNotification(
  payload: NotificationPayload
): Promise<NotificationResult> {
  return callFunction<NotificationResult>('attendance-notification', {
    method: 'POST',
    body: payload,
  })
}

export async function getNotifications(
  teacherId?: string,
  limit = 20
): Promise<{ notifications: NotificationRecord[] }> {
  return callFunction<{ notifications: NotificationRecord[] }>('attendance-notification', {
    params: {
      ...(teacherId ? { teacher_id: teacherId } : {}),
      limit: String(limit),
    },
  })
}

export interface AIInsight {
  teacher_id: string
  name: string
  late_count: number
  avg_late_minutes: number
}

export interface AIAbsenteeism {
  teacher_id: string
  name: string
  absent_count: number
}

export interface AIAnalysisResult {
  success: boolean
  insights: {
    month: string
    summary: {
      total_records: number
      present: number
      late: number
      absent: number
      avg_working_minutes: number
      attendance_rate: number
    }
    teachers_with_frequent_lateness: AIInsight[]
    teachers_with_high_absenteeism: AIAbsenteeism[]
    suggestions: string[]
  }
  ai_generated: {
    provider: string
    recommendations?: string[]
    raw?: string
  } | null
  config: {
    provider_configured: string | null
    openai_available: boolean
    deepseek_available: boolean
  }
}

export interface AttendanceValidatorInput {
  teacher_id: string
  attendance_date: string
  check_in?: string
  check_out?: string
}

export interface AttendanceValidatorResult {
  success: boolean
  validated: {
    teacher: string
    teacher_id: string
    staff_number: string
    attendance_date: string
    status: string
    check_in?: string
    check_out?: string
    late_minutes?: number
    early_departure_minutes?: number
    working_hours?: string
  }
  config: {
    reporting_start_time: string
    grace_period_minutes: number
    checkout_time: string
  }
}

export async function validateAttendance(
  input: AttendanceValidatorInput
): Promise<AttendanceValidatorResult> {
  return callFunction<AttendanceValidatorResult>('attendance-validator', {
    method: 'POST',
    body: input,
  })
}

export async function getAttendanceAnalytics(
  options: {
    month?: number
    year?: number
    teacher_id?: string
    provider?: 'openai' | 'deepseek'
  } = {}
): Promise<AIAnalysisResult> {
  return callFunction<AIAnalysisResult>('attendance-ai-analysis', {
    method: 'POST',
    body: options,
  })
}
