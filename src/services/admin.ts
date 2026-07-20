import { supabase } from './supabase'
import type { Teacher, SchoolHoliday, SchoolSettings, Attendance } from '@/types'

// ─── Dashboard Stats ─────────────────────────────────────────
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

// ─── Teachers CRUD ───────────────────────────────────────────
export async function getTeachers(): Promise<Teacher[]> {
  const { data, error } = await supabase
    .from('teachers')
    .select('*')
    .order('full_name', { ascending: true })

  if (error) throw new Error(error.message)
  return data as Teacher[]
}

export async function createTeacher(input: {
  staff_number: string
  full_name: string
  email: string
  department?: string
  phone?: string
  reporting_time?: string
  employment_status?: string
}): Promise<Teacher> {
  const { data, error } = await supabase
    .from('teachers')
    .insert({
      staff_number: input.staff_number,
      full_name: input.full_name,
      email: input.email,
      department: input.department || null,
      phone: input.phone || null,
      reporting_time: input.reporting_time || null,
      employment_status: input.employment_status || 'active',
    })
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as Teacher
}

export async function updateTeacher(
  id: string,
  input: Partial<{
    staff_number: string
    full_name: string
    email: string
    department: string | null
    phone: string | null
    reporting_time: string | null
    employment_status: string
  }>
): Promise<Teacher> {
  const { data, error } = await supabase
    .from('teachers')
    .update(input)
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as Teacher
}

export async function getHolidays(): Promise<SchoolHoliday[]> {
  const { data, error } = await supabase
    .from('school_holidays')
    .select('*')
    .order('date', { ascending: false })

  if (error) throw new Error(error.message)
  return data as SchoolHoliday[]
}

export async function createHoliday(input: {
  date: string
  description: string
}): Promise<SchoolHoliday> {
  const { data, error } = await supabase
    .from('school_holidays')
    .insert({ date: input.date, description: input.description })
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as SchoolHoliday
}

export async function deleteHoliday(id: string): Promise<void> {
  const { error } = await supabase
    .from('school_holidays')
    .delete()
    .eq('id', id)

  if (error) throw new Error(error.message)
}

export async function getSchoolSettings(): Promise<SchoolSettings | null> {
  const { data, error } = await supabase
    .from('school_settings')
    .select('*')
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data as SchoolSettings | null
}

export async function updateSchoolSettings(
  input: Partial<{
    school_name: string
    latitude: number
    longitude: number
    allowed_radius: number
    default_reporting_time: string
  }>
): Promise<SchoolSettings> {
  const { data, error } = await supabase
    .from('school_settings')
    .update(input)
    .eq('id', (await getSchoolSettings())?.id ?? '')
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as SchoolSettings
}

// ─── Attendance Records ──────────────────────────────────────
export interface AttendanceFilters {
  date?: string
  status?: string
  teacher_id?: string
  page?: number
  page_size?: number
}

export interface AttendanceWithTeacher extends Attendance {
  teacher: {
    full_name: string
    staff_number: string
  } | null
}

export interface PaginatedAttendance {
  records: AttendanceWithTeacher[]
  total: number
  page: number
  page_size: number
}

export async function getAttendanceRecords(filters: AttendanceFilters = {}): Promise<PaginatedAttendance> {
  const page = filters.page ?? 1
  const page_size = filters.page_size ?? 20
  const from = (page - 1) * page_size
  const to = from + page_size - 1

  let query = supabase
    .from('attendance')
    .select('*, teacher:teachers(*)', { count: 'exact' })

  if (filters.date) query = query.eq('attendance_date', filters.date)
  if (filters.status) query = query.eq('status', filters.status)
  if (filters.teacher_id) query = query.eq('teacher_id', filters.teacher_id)

  const { data, error, count } = await query
    .order('attendance_date', { ascending: false })
    .order('check_in', { ascending: false })
    .range(from, to)

  if (error) throw new Error(error.message)
  return { records: (data ?? []) as unknown as AttendanceWithTeacher[], total: count ?? 0, page, page_size }
}

// ─── Teacher Delete ──────────────────────────────────────────
export async function deleteTeacher(id: string): Promise<void> {
  const { error } = await supabase.from('teachers').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// ─── Export helpers ──────────────────────────────────────────
export function exportToCSV(records: AttendanceWithTeacher[], filename: string) {
  const headers = ['Teacher', 'Staff No.', 'Date', 'Check In', 'Check Out', 'Status', 'Late (min)', 'Working (min)']
  const rows = records.map(r => [
    r.teacher?.full_name ?? '',
    r.teacher?.staff_number ?? '',
    r.attendance_date,
    r.check_in ? new Date(r.check_in).toLocaleTimeString() : '-',
    r.check_out ? new Date(r.check_out).toLocaleTimeString() : '-',
    r.status,
    r.late_minutes ?? 0,
    r.working_minutes ?? 0,
  ])
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Invite teacher (via Netlify serverless function — same origin, no CORS) ─────
export async function inviteTeacher(input: {
  staff_number: string
  full_name: string
  email: string
  department?: string
  phone?: string
  reporting_time?: string
}): Promise<{ teacher: Teacher; tempPassword: string }> {
  const { data: session } = await supabase.auth.getSession()
  const token = session?.session?.access_token
  if (!token) throw new Error('Not authenticated')

  const url = '/.netlify/functions/invite-teacher'
  console.log('[inviteTeacher] Calling:', url, { email: input.email })

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    })
  } catch (fetchErr) {
    console.error('[inviteTeacher] Fetch failed:', fetchErr)
    throw new Error(
      (fetchErr as Error)?.message?.includes('fetch') ||
      (fetchErr as Error)?.message?.includes('network')
        ? 'Cannot reach server. Check your internet connection.'
        : (fetchErr as Error).message
    )
  }

  let body: { teacher?: Teacher; tempPassword?: string; error?: string }
  try {
    body = await res.json()
  } catch {
    throw new Error(`Server returned ${res.status} with no JSON body`)
  }

  if (!res.ok) {
    throw new Error(body?.error ?? `Request failed (${res.status})`)
  }

  if (!body.teacher || !body.tempPassword) {
    throw new Error('Server response missing teacher or tempPassword')
  }

  return body as { teacher: Teacher; tempPassword: string }
}

function rowFromRecord(r: AttendanceWithTeacher): string[] {
  return [
    r.teacher?.full_name ?? '',
    r.teacher?.staff_number ?? '',
    r.attendance_date,
    r.check_in ? new Date(r.check_in).toLocaleTimeString() : '-',
    r.check_out ? new Date(r.check_out).toLocaleTimeString() : '-',
    r.status ?? '-',
    String(r.late_minutes ?? 0),
    String(r.working_minutes ?? 0),
  ]
}

// ─── Excel export ────────────────────────────────────────────
export function exportToExcel(records: AttendanceWithTeacher[], filename: string) {
  const headers = [['Teacher', 'Staff No.', 'Date', 'Check In', 'Check Out', 'Status', 'Late (min)', 'Working (min)']]
  const rows = records.map(r => rowFromRecord(r))
  const wsData = [...headers, ...rows]

  import('xlsx').then((XLSX) => {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet(wsData)
    XLSX.utils.book_append_sheet(wb, ws, 'Attendance')
    XLSX.writeFile(wb, `${filename}.xlsx`)
  })
}

// ─── PDF export ──────────────────────────────────────────────
export function exportToPDF(records: AttendanceWithTeacher[], filename: string) {
  const headers = [['Teacher', 'Staff No.', 'Date', 'Check In', 'Check Out', 'Status', 'Late (min)', 'Working (min)']]
  const rows = records.map(r => rowFromRecord(r))

  import('jspdf').then(async ({ default: jsPDF }) => {
    await import('jspdf-autotable')
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' }) as unknown as {
      text: (text: string, x: number, y: number) => void
      autoTable: (options: {
        startY: number
        head: string[][]
        body: string[][]
        styles?: Record<string, unknown>
        headStyles?: Record<string, unknown>
      }) => void
      save: (filename: string) => void
    }
    doc.text(`Attendance Report - ${filename}`, 14, 15)
    doc.autoTable({
      startY: 22,
      head: [headers[0]],
      body: rows,
      styles: { fontSize: 7 },
      headStyles: { fillColor: [59, 130, 246] },
    })
    doc.save(`${filename}.pdf`)
  })
}

// ─── Export all pages ────────────────────────────────────────
export async function exportAllAttendance(format: 'csv' | 'xlsx' | 'pdf', filename: string) {
  const { records } = await getAttendanceRecords({ page: 1, page_size: 10000 })
  if (format === 'csv') exportToCSV(records, filename)
  else if (format === 'xlsx') exportToExcel(records, filename)
  else exportToPDF(records, filename)
}
