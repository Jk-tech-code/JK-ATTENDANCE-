import { supabase } from './supabase'
import type { Attendance } from '@/types'

export interface SchoolCalendarEntry {
  id: string
  calendar_date: string
  day_type: 'working_day' | 'weekend' | 'holiday' | 'event'
  title: string | null
  description: string | null
  created_by: string | null
  created_at: string
}

export interface CalendarDay {
  date: string
  day_type: string
  title: string
  description: string | null
  present: number
  late: number
  absent: number
  total: number
}

export interface MonthCalendar {
  year: number
  month: number
  total_days: number
  calendar: CalendarDay[]
}

export interface HolidayEntry {
  id: string
  title: string
  description: string | null
  holiday_date: string
  type: 'holiday' | 'event'
  created_at: string
}

export interface DateCheckResult {
  date: string
  day_type: string
  title: string
  is_weekend: boolean
  is_holiday: boolean
  attendance_allowed: boolean
}

export interface DayAttendance {
  date: string
  day_type: string
  title: string | null
  records: (Attendance & { teacher: { full_name: string; staff_number: string } })[]
  summary: {
    present: number
    late: number
    absent: number
    checked_out: number
    total: number
    attendance_rate: number
  }
}

// ─── Holiday entries ─────────────────────────────────────────

// Map a raw Supabase/PostgREST error to a user-friendly message for
// the calendar RPCs. Detects the case where the function has not
// been deployed (or migration 00049 has not been applied) and
// returns a safe generic message instead of leaking the raw
// "Could not find function public.create_calendar_entry" string.
// The 23505 / 22023 / P0002 mappings are handled in their own
// error branches so the order of checks in callers matters.
function friendlyCalendarRpcError(err: { code?: string; message?: string }): string {
  const code = err.code ?? ''
  const message = err.message ?? ''
  if (code === 'PGRST202' || /Could not find function/i.test(message)) {
    return 'Calendar system is not available yet. Please contact your administrator.'
  }
  return message || 'Calendar operation failed. Please try again.'
}

export async function getHolidayEntries(date: string): Promise<HolidayEntry[]> {
  const { data, error } = await supabase
    .from('holidays')
    .select('*')
    .eq('holiday_date', date)
    .order('created_at', { ascending: false })

  if (error) {
    if (error.code === '42P01') return []
    throw new Error(error.message)
  }
  return data as HolidayEntry[]
}

export async function getHolidayRange(startDate: string, endDate: string): Promise<HolidayEntry[]> {
  const { data, error } = await supabase
    .from('holidays')
    .select('*')
    .gte('holiday_date', startDate)
    .lte('holiday_date', endDate)
    .order('holiday_date', { ascending: true })

  if (error) {
    if (error.code === '42P01') return []
    throw new Error(error.message)
  }
  return data as HolidayEntry[]
}

// ─── CRUD operations ─────────────────────────────────────────

export async function getMonthCalendar(year: number, month: number): Promise<MonthCalendar> {
  const { data, error } = await supabase.rpc('get_month_calendar', {
    p_year: year,
    p_month: month,
  })

  if (error) throw new Error(error.message)
  return data as MonthCalendar
}

export async function checkDate(date: string): Promise<DateCheckResult> {
  const { data, error } = await supabase.rpc('check_calendar_date', {
    p_date: date,
  })

  if (error) throw new Error(error.message)
  return data as DateCheckResult
}

export async function getCalendarEntries(
  startDate: string,
  endDate: string
): Promise<SchoolCalendarEntry[]> {
  const { data, error } = await supabase
    .from('school_calendar')
    .select('*')
    .gte('calendar_date', startDate)
    .lte('calendar_date', endDate)
    .order('calendar_date', { ascending: true })

  if (error) throw new Error(error.message)
  return data as SchoolCalendarEntry[]
}

export async function createCalendarEntry(input: {
  calendar_date: string
  day_type: 'working_day' | 'weekend' | 'holiday' | 'event'
  title: string
  description?: string
}): Promise<SchoolCalendarEntry> {
  const { data: user, error: userErr } = await supabase.auth.getUser()
  if (userErr || !user?.user) throw new Error('Authentication required')

  // Atomic write via SECURITY DEFINER RPC. The RPC inserts the
  // school_calendar row and reconciles the denormalized holidays
  // cache in a single transaction — no more drift between the two
  // tables. See migration 00049_calendar_holiday_atomic_writes.sql.
  const { data, error } = await supabase.rpc('create_calendar_entry', {
    p_calendar_date: input.calendar_date,
    p_day_type: input.day_type,
    p_title: input.title,
    p_description: input.description ?? null,
    p_created_by: user.user.id,
  })

  if (error) {
    if (error.code === '23505') {
      throw new Error(`A calendar entry already exists for ${input.calendar_date}`)
    }
    if (error.code === '22023') throw new Error(`Invalid day type: ${input.day_type}`)
    throw new Error(friendlyCalendarRpcError(error))
  }

  // The RPC returns a setof row; .single() would expect one row
  // but PostgREST's RPC representation is an array. Take the first.
  const row = (Array.isArray(data) ? data[0] : data) as SchoolCalendarEntry | undefined
  if (!row) throw new Error('Calendar entry was not created')
  return row
}

export async function updateCalendarEntry(
  id: string,
  input: Partial<{
    calendar_date: string
    day_type: 'working_day' | 'weekend' | 'holiday' | 'event'
    title: string
    description: string
  }>
): Promise<SchoolCalendarEntry> {
  // Atomic update via SECURITY DEFINER RPC. Reconciles the holidays
  // cache when day_type changes (deletes the old row, upserts the
  // new). See migration 00049.
  const { data, error } = await supabase.rpc('update_calendar_entry', {
    p_id: id,
    p_calendar_date: input.calendar_date ?? null,
    p_day_type: input.day_type ?? null,
    p_title: input.title ?? null,
    p_description: input.description ?? null,
  })

  if (error) {
    if (error.code === '23505') {
      throw new Error(`A calendar entry already exists for ${input.calendar_date}`)
    }
    if (error.code === '22023') throw new Error(`Invalid day type: ${input.day_type}`)
    if (error.code === 'P0002') throw new Error('Calendar entry not found')
    throw new Error(friendlyCalendarRpcError(error))
  }

  const row = (Array.isArray(data) ? data[0] : data) as SchoolCalendarEntry | undefined
  if (!row) throw new Error('Calendar entry was not updated')
  return row
}

export async function deleteCalendarEntry(id: string): Promise<void> {
  // Atomic delete via SECURITY DEFINER RPC. Removes the
  // school_calendar row and the matching holidays row in one
  // transaction. See migration 00049.
  const { error } = await supabase.rpc('delete_calendar_entry', { p_id: id })
  if (error) {
    if (error.code === 'P0002') throw new Error('Calendar entry not found')
    throw new Error(friendlyCalendarRpcError(error))
  }
}

export async function autoPopulateWeekends(startYear: number, endYear: number): Promise<number> {
  const { data, error } = await supabase.rpc('auto_populate_weekends', {
    p_start_year: startYear,
    p_end_year: endYear,
  })

  if (error) throw new Error(error.message)
  return data as number
}

// ─── Day attendance detail ───────────────────────────────────

export async function getDayAttendanceDetail(date: string): Promise<DayAttendance> {
  const [dateCheck, recordsResult] = await Promise.all([
    checkDate(date),
    supabase
      .from('attendance')
      .select('*, teacher:teachers(full_name, staff_number)')
      .eq('attendance_date', date)
      .order('check_in', { ascending: true }),
  ])

  if (recordsResult.error) throw new Error(recordsResult.error.message)

  const records = (recordsResult.data || []) as DayAttendance['records']
  const present = records.filter((r) => ['present', 'checked_out'].includes(r.status ?? '')).length
  const late = records.filter((r) => r.status === 'late').length
  const absent = records.filter((r) => r.status === 'absent').length
  const checkedOut = records.filter((r) => r.status === 'checked_out').length
  const total = records.length

  return {
    date,
    day_type: dateCheck.day_type,
    title: dateCheck.title,
    records,
    summary: {
      present,
      late,
      absent,
      checked_out: checkedOut,
      total,
      attendance_rate: total > 0 ? Math.round(((present + late) / total) * 100) : 0,
    },
  }
}

// ─── Monthly report generation (calendar-aware) ──────────────

export async function generateMonthlyReport(year: number, month: number) {
  const monthCal = await getMonthCalendar(year, month)
  const workingDays = monthCal.calendar.filter((d) => d.day_type === 'working_day')

  const totalTeachersRes = await supabase
    .from('teachers')
    .select('id', { count: 'exact' })
    .eq('employment_status', 'active')

  const totalTeachers = totalTeachersRes.count ?? 0
  const totalWorkingDays = workingDays.length
  const totalPossibleAttendance = totalTeachers * totalWorkingDays

  let totalPresent = 0
  let totalLate = 0
  let totalAbsent = 0

  for (const day of workingDays) {
    totalPresent += day.present
    totalLate += day.late
    totalAbsent += day.absent
  }

  const attendanceRate =
    totalPossibleAttendance > 0
      ? Math.round(((totalPresent + totalLate) / totalPossibleAttendance) * 100)
      : 0

  return {
    year,
    month,
    total_teachers: totalTeachers,
    total_working_days: totalWorkingDays,
    total_possible_attendance: totalPossibleAttendance,
    total_present: totalPresent,
    total_late: totalLate,
    total_absent: totalAbsent,
    attendance_rate: attendanceRate,
    working_days: workingDays.map((d) => ({
      date: d.date,
      present: d.present,
      late: d.late,
      absent: d.absent,
      total: d.total,
    })),
  }
}
