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
  const { data, error } = await supabase
    .from('school_calendar')
    .insert({
      calendar_date: input.calendar_date,
      day_type: input.day_type,
      title: input.title,
      description: input.description || null,
      created_by: (await supabase.auth.getUser()).data.user?.id,
    })
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as SchoolCalendarEntry
}

export async function updateCalendarEntry(
  id: string,
  input: Partial<{
    day_type: 'working_day' | 'weekend' | 'holiday' | 'event'
    title: string
    description: string
  }>
): Promise<SchoolCalendarEntry> {
  const { data, error } = await supabase
    .from('school_calendar')
    .update(input)
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as SchoolCalendarEntry
}

export async function deleteCalendarEntry(id: string): Promise<void> {
  const { error } = await supabase.from('school_calendar').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function autoPopulateWeekends(
  startYear: number,
  endYear: number
): Promise<number> {
  const { data, error } = await supabase.rpc('auto_populate_weekends', {
    p_start_year: startYear,
    p_end_year: endYear,
  })

  if (error) throw new Error(error.message)
  return data as number
}

// ─── Day attendance detail ───────────────────────────────────

export async function getDayAttendanceDetail(
  date: string
): Promise<DayAttendance> {
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
  const present = records.filter(r => ['present', 'checked_out'].includes(r.status ?? '')).length
  const late = records.filter(r => r.status === 'late').length
  const absent = records.filter(r => r.status === 'absent').length
  const checkedOut = records.filter(r => r.status === 'checked_out').length
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
  const workingDays = monthCal.calendar.filter(d => d.day_type === 'working_day')

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
    working_days: workingDays.map(d => ({
      date: d.date,
      present: d.present,
      late: d.late,
      absent: d.absent,
      total: d.total,
    })),
  }
}
