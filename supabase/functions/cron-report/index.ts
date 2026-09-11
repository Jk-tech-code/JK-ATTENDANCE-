// ============================================
// JK Attendance - Cron Report Generator
// ============================================
// Triggered by Supabase Cron or external cron service:
//   POST /functions/v1/cron-report
//   Body: { type: "daily" }  or { type: "monthly", year?: 2026, month?: 7 }
//
// Without body, defaults to today's daily report.
//
// Stores results in the report_store table via UPSERT (idempotent
// re-runs overwrite the previous report for the same period).
// The report_store table is admin-read-only via RLS.
// ============================================

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createSupabaseAdmin } from '../_shared/supabase.ts'
import { handleCors, jsonResponse } from '../_shared/cors.ts'
import { timingSafeEqualStrings } from '../_shared/timing.ts'
import { todayEat, currentYearEat, currentMonthEat, toNairobiMinutes } from '../_shared/timezone.ts'

export async function handler(req: Request): Promise<Response> {
  const cors = handleCors(req)
  if (cors) return cors

  // Only accept the secret via the dedicated x-api-key header — never reuse
  // the Authorization header (which carries JWTs on every other function).
  const cronSecret = Deno.env.get('CRON_SECRET')
  if (!cronSecret) {
    console.error('CRON_SECRET environment variable is not set. Rejecting request.')
    return jsonResponse({ error: 'Server misconfigured: CRON_SECRET not set' }, 500)
  }
  const apiKey = req.headers.get('x-api-key')
  if (!apiKey || !timingSafeEqualStrings(apiKey, cronSecret)) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  try {
    const supabase = createSupabaseAdmin()

    // Parse request body
    let body: { type?: string; year?: number; month?: number } = {}
    try {
      if (req.method === 'POST') {
        body = await req.json()
      }
    } catch {
      // No body or invalid JSON — use defaults
    }

    const type = body.type ?? 'daily'

    if (type === 'daily') {
      const result = await generateDailyReport(supabase)
      await storeReport(supabase, 'daily', result.date, result.date, result)
      return jsonResponse({ success: true, report: result })
    }

    if (type === 'monthly') {
      const year = body.year ?? currentYearEat()
      const month = body.month ?? currentMonthEat()

      // Validate year/month ranges
      if (year < 2000 || year > 2100) {
        return jsonResponse({ error: 'Invalid year: must be between 2000 and 2100' }, 400)
      }
      if (month < 1 || month > 12) {
        return jsonResponse({ error: 'Invalid month: must be between 1 and 12' }, 400)
      }

      const result = await generateMonthlyReport(supabase, year, month)
      const periodStart = `${year}-${String(month).padStart(2, '0')}-01`
      const endDate = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
      await storeReport(supabase, 'monthly', periodStart, endDate, result)
      return jsonResponse({ success: true, report: result })
    }

    return jsonResponse({ error: `Unknown report type: ${type}` }, 400)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('cron-report error:', message)
    return jsonResponse({ error: message }, 500)
  }
}

// ─── Daily Report Generation ─────────────────────────────────
async function generateDailyReport(supabase: ReturnType<typeof createSupabaseAdmin>) {
  const dateParam = todayEat()

  const { count: presentCount } = await supabase
    .from('attendance')
    .select('id', { count: 'exact' })
    .eq('attendance_date', dateParam)
    .in('status', ['present', 'checked_out'])

  const { count: absentCount } = await supabase
    .from('attendance')
    .select('id', { count: 'exact' })
    .eq('attendance_date', dateParam)
    .eq('status', 'absent')

  const { count: lateCount } = await supabase
    .from('attendance')
    .select('id', { count: 'exact' })
    .eq('attendance_date', dateParam)
    .eq('status', 'late')

  const { count: checkedOutCount } = await supabase
    .from('attendance')
    .select('id', { count: 'exact' })
    .eq('attendance_date', dateParam)
    .eq('status', 'checked_out')

  const { count: totalTeachers } = await supabase
    .from('teachers')
    .select('id', { count: 'exact' })
    .eq('employment_status', 'active')

  const pCount = presentCount ?? 0
  const lCount = lateCount ?? 0
  const attendanceRate =
    totalTeachers && totalTeachers > 0 ? Math.round(((pCount + lCount) / totalTeachers) * 100) : 0

  // Average check-in time and working minutes
  const { data: avgData } = await supabase
    .from('attendance')
    .select('check_in, working_minutes')
    .eq('attendance_date', dateParam)
    .not('check_in', 'is', null)

  let avgCheckIn = '-'
  let avgWorkingMinutes = 0

  if (avgData && avgData.length > 0) {
    const times = avgData
      .map((r) => r.check_in)
      .filter(Boolean)
      .map((t) => toNairobiMinutes(t!).totalMinutes)

    if (times.length > 0) {
      const avgMinutes = Math.round(times.reduce((a, b) => a + b, 0) / times.length)
      const h = Math.floor(avgMinutes / 60)
      const m = avgMinutes % 60
      avgCheckIn = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    }

    const workingMinutes = avgData
      .map((r) => r.working_minutes)
      .filter((m): m is number => m !== null)
    if (workingMinutes.length > 0) {
      avgWorkingMinutes = Math.round(
        workingMinutes.reduce((a, b) => a + b, 0) / workingMinutes.length
      )
    }
  }

  return {
    date: dateParam,
    present: pCount,
    absent: absentCount ?? 0,
    late: lCount,
    checked_out: checkedOutCount ?? 0,
    total_teachers: totalTeachers ?? 0,
    attendance_rate: attendanceRate,
    avg_check_in_time: avgCheckIn,
    avg_working_minutes: avgWorkingMinutes,
  }
}

// ─── Monthly Report Generation ────────────────────────────────
async function generateMonthlyReport(
  supabase: ReturnType<typeof createSupabaseAdmin>,
  year: number,
  month: number
) {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  const endDate = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)

  const { data: workingDaysData, error: wdErr } = await supabase.rpc('count_month_working_days', {
    p_year: year,
    p_month: month,
  })
  if (wdErr) throw wdErr
  const workingDays = workingDaysData as number

  const { data: allAttendance } = await supabase
    .from('attendance')
    .select('teacher_id, status, check_in, check_out, working_minutes, late_minutes')
    .gte('attendance_date', startDate)
    .lte('attendance_date', endDate)

  const { data: teachers } = await supabase
    .from('teachers')
    .select('id, full_name, staff_number')
    .eq('employment_status', 'active')

  const presentCount =
    allAttendance?.filter((a) => ['present', 'checked_out'].includes(a.status ?? '')).length ?? 0
  const lateCount = allAttendance?.filter((a) => a.status === 'late').length ?? 0
  const absentCount = allAttendance?.filter((a) => a.status === 'absent').length ?? 0

  const teacherCount = teachers?.length ?? 0
  const totalPossibleAttendance = teacherCount * workingDays
  const attendancePercentage =
    totalPossibleAttendance > 0
      ? Math.round(((presentCount + lateCount) / totalPossibleAttendance) * 100)
      : 0

  const teacherStats = (teachers ?? []).map((teacher) => {
    const records = allAttendance?.filter((a) => a.teacher_id === teacher.id) ?? []
    const present = records.filter((r) =>
      ['present', 'checked_out'].includes(r.status ?? '')
    ).length
    const late = records.filter((r) => r.status === 'late').length
    const absent = records.filter((r) => r.status === 'absent').length
    const total = records.length
    const workingMinutes = records
      .map((r) => r.working_minutes)
      .filter((m): m is number => m !== null)
    const avgHours =
      workingMinutes.length > 0
        ? Math.round((workingMinutes.reduce((a, b) => a + b, 0) / workingMinutes.length) * 10) / 10
        : 0

    return {
      teacher_id: teacher.id,
      full_name: teacher.full_name,
      staff_number: teacher.staff_number,
      total_days: total,
      present,
      late,
      absent,
      attendance_percentage: total > 0 ? Math.round(((present + late) / total) * 100) : 0,
      avg_working_hours: avgHours,
    }
  })

  const allWorkingMinutes = allAttendance
    ?.map((a) => a.working_minutes)
    .filter((m): m is number => m !== null)
  const overallAvgHours =
    allWorkingMinutes && allWorkingMinutes.length > 0
      ? Math.round((allWorkingMinutes.reduce((a, b) => a + b, 0) / allWorkingMinutes.length) * 10) /
        10
      : 0

  return {
    year,
    month,
    period_start: startDate,
    period_end: endDate,
    summary: {
      total_teachers: teacherCount,
      working_days: workingDays,
      present_days: presentCount,
      late_days: lateCount,
      absent_days: absentCount,
      attendance_percentage: attendancePercentage,
      avg_working_hours: overallAvgHours,
    },
    teachers: teacherStats,
  }
}

// ─── Store report in report_store table (UPSERT) ──────────────
async function storeReport(
  supabase: ReturnType<typeof createSupabaseAdmin>,
  reportType: string,
  periodStart: string,
  periodEnd: string,
  data: Record<string, unknown>
) {
  const { error } = await supabase.from('report_store').upsert(
    {
      report_type: reportType,
      period_start: periodStart,
      period_end: periodEnd,
      data,
    },
    { onConflict: 'report_type,period_start' }
  )

  if (error) {
    console.error(`Failed to store ${reportType} report:`, error.message)
    throw new Error(`Failed to persist ${reportType} report: ${error.message}`)
  }
}

if (typeof Deno !== 'undefined' && typeof Deno.serve === 'function') {
  console.warn('cron-report invoked')
  Deno.serve(handler)
}
