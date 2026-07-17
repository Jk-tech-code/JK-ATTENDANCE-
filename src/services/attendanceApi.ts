import { supabase } from './supabase'
import type { Attendance } from '@/types'

const EDGE_FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_URL?.replace('.co', '.functions.supabase.co') + '/functions/v1'

async function getAuthToken(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Not authenticated')
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

  const response = await fetch(url.toString(), {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }))
    throw new Error(error.error ?? `Edge Function error: ${response.status}`)
  }

  return response.json()
}

export interface RecordAttendanceInput {
  teacher_id: string
  attendance_date: string
  check_in?: string
  check_out?: string
  status: 'present' | 'late' | 'absent' | 'checked_out'
  latitude?: number
  longitude?: number
  device?: string
  browser?: string
  notes?: string
}

export interface RecordAttendanceResult {
  success: boolean
  message: string
  attendance: Attendance
}

export async function recordAttendance(input: RecordAttendanceInput): Promise<RecordAttendanceResult> {
  return callFunction<RecordAttendanceResult>('record-attendance', {
    method: 'POST',
    body: input,
  })
}

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

export interface NotificationResult {
  success: boolean
  message: string
  notifications_created?: number
  teachers_notified?: Array<{ id: string; name: string; email: string }>
  notification?: any
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

export async function getNotifications(teacherId?: string, limit = 20): Promise<{ notifications: any[] }> {
  return callFunction<{ notifications: any[] }>('attendance-notification', {
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

export async function getAttendanceAnalytics(options: {
  month?: number
  year?: number
  teacher_id?: string
  provider?: 'openai' | 'deepseek'
} = {}): Promise<AIAnalysisResult> {
  return callFunction<AIAnalysisResult>('attendance-ai-analysis', {
    method: 'POST',
    body: options,
  })
}
