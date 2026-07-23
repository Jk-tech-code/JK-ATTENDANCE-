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
  // Creates teacher via edge function which:
  //   1. Checks for duplicate email/staff_number
  //   2. Creates auth user via inviteUserByEmail (sends invitation email)
  //   3. Creates teacher record linked to auth user
  //   4. Rolls back on failure
  return callInviteEdgeFunction(input)
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
  // Fetch current settings ID first
  const current = await supabase
    .from('school_settings')
    .select('id')
    .limit(1)
    .maybeSingle()

  const settingsId = current.data?.id
  if (!settingsId) throw new Error('School settings not found')

  const { data, error } = await supabase
    .from('school_settings')
    .update(input)
    .eq('id', settingsId)
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
  const { data: session } = await supabase.auth.getSession()
  const token = session?.session?.access_token
  if (!token) throw new Error('Not authenticated')

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const url = `${supabaseUrl}/functions/v1/delete-teacher`
  console.log('[deleteTeacher] Calling:', url, { teacher_id: id })

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ teacher_id: id }),
    })
  } catch {
    throw new Error('Cannot reach server. Check your internet connection.')
  }

  const body = await res.json()
  if (!res.ok || !body.success) {
    throw new Error(body?.error ?? 'Failed to delete teacher')
  }
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

// ─── Invite teacher ──────────────────────────────────────────
export async function inviteTeacher(input: {
  staff_number: string
  full_name: string
  email: string
  department?: string
  phone?: string
  reporting_time?: string
}): Promise<{ teacher: Teacher }> {
  const teacher = await callInviteEdgeFunction(input)
  return { teacher }
}

// ─── Shared edge function caller ─────────────────────────────
async function callInviteEdgeFunction(input: {
  staff_number: string
  full_name: string
  email: string
  department?: string
  phone?: string
  reporting_time?: string
}): Promise<Teacher> {
  const { data: session } = await supabase.auth.getSession()
  const token = session?.session?.access_token
  if (!token) throw new Error('Not authenticated')

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const url = `${supabaseUrl}/functions/v1/invite-teacher`
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

  let body: { teacher?: Teacher; error?: string }
  try {
    body = await res.json()
  } catch {
    throw new Error(`Server returned ${res.status} with no JSON body`)
  }

  if (!res.ok) {
    throw new Error(body?.error ?? `Request failed (${res.status})`)
  }

  if (!body.teacher) {
    throw new Error('Server response missing teacher record')
  }

  return body.teacher
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
export async function exportToExcel(records: AttendanceWithTeacher[], filename: string): Promise<void> {
  const headers = [['Teacher', 'Staff No.', 'Date', 'Check In', 'Check Out', 'Status', 'Late (min)', 'Working (min)']]
  const rows = records.map(r => rowFromRecord(r))
  const wsData = [...headers, ...rows]

  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(wsData)
  XLSX.utils.book_append_sheet(wb, ws, 'Attendance')
  XLSX.writeFile(wb, `${filename}.xlsx`)
}

// ─── PDF export ──────────────────────────────────────────────
export async function exportToPDF(records: AttendanceWithTeacher[], filename: string): Promise<void> {
  try {
    const headers = ['Teacher', 'Staff No.', 'Date', 'Check In', 'Check Out', 'Status', 'Late (min)', 'Working (min)']
    const rows = records.map(r => rowFromRecord(r))

    const totals = records.reduce(
      (acc, r) => {
        const s = (r.status ?? '').toLowerCase()
        if (s === 'present' || s === 'checked_out') acc.present++
        else if (s === 'late') acc.late++
        else if (s === 'absent') acc.absent++
        return acc
      },
      { present: 0, absent: 0, late: 0 }
    )

    const [{ default: jsPDF }, { autoTable }] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ])

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const marginLeft = 14

    doc.setFontSize(14)
    doc.text('JK Attendance System', marginLeft, 15)
    doc.setFontSize(10)
    doc.text(`Attendance Report - ${filename}`, marginLeft, 22)
    doc.setFontSize(8)
    doc.text(`Generated: ${new Date().toLocaleString()}`, marginLeft, 28)

    autoTable(doc, {
      startY: 32,
      head: [headers],
      body: rows,
      styles: { fontSize: 7 },
      headStyles: { fillColor: [59, 130, 246] },
      foot: [[
        `Present: ${totals.present}`,
        '',
        '',
        '',
        '',
        `Absent: ${totals.absent}`,
        `Late: ${totals.late}`,
        `Total: ${records.length}`,
      ]],
      footStyles: { fillColor: [243, 244, 246], textColor: [0, 0, 0], fontStyle: 'bold', fontSize: 7 },
      didDrawPage: (data) => {
        const pageHeight = doc.internal.pageSize.getHeight()
        doc.setFontSize(8)
        doc.text(
          `Page ${data.pageNumber}`,
          marginLeft,
          pageHeight - 10
        )
      },
    })

    doc.save(`${filename}.pdf`)
  } catch (error) {
    console.error('[exportToPDF] Failed to generate PDF:', error)
    throw new Error('Failed to generate PDF report. Please try again.')
  }
}

// ─── Export all pages ────────────────────────────────────────
export async function exportAllAttendance(format: 'csv' | 'xlsx' | 'pdf', filename: string): Promise<void> {
  const { records } = await getAttendanceRecords({ page: 1, page_size: 10000 })
  if (format === 'csv') exportToCSV(records, filename)
  else if (format === 'xlsx') await exportToExcel(records, filename)
  else await exportToPDF(records, filename)
}
