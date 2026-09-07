import { supabase } from '@/services/supabase'

// ─── Dashboard stats ─────────────────────────────────────────
export interface DashboardStats {
  total_teachers: number
  present_today: number
  late_today: number
  absent_today: number
  checked_out_today: number
  in_school_now: number
  early_departure_today?: number
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const { data, error } = await supabase.rpc('get_admin_dashboard_stats')
  if (error) throw new Error(error.message)
  return data as DashboardStats
}

export interface DailyReportResult {
  date: string
  present: number
  absent: number
  late: number
  total_teachers: number
  attendance_rate: number
  avg_check_in_time: string
  avg_working_minutes: number
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
  teachers: Array<{
    teacher_id: string
    full_name: string
    staff_number: string
    total_days: number
    present: number
    late: number
    absent: number
    attendance_percentage: number
    avg_working_hours: number
  }>
}

export async function getDailyReport(date: string): Promise<DailyReportResult> {
  const { data, error } = await supabase.rpc('get_daily_report', { p_date: date })
  if (error) throw new Error(error.message)
  return data as DailyReportResult
}

export async function getMonthlyReport(year: number, month: number): Promise<MonthlyReportResult> {
  const { data, error } = await supabase.rpc('get_monthly_report', { p_year: year, p_month: month })
  if (error) throw new Error(error.message)
  return data as MonthlyReportResult
}
