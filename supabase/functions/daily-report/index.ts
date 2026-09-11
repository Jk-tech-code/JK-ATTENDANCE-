import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { jsonResponse } from '../_shared/cors.ts'
import { createSupabaseAdmin } from '../_shared/supabase.ts'
import { adminMiddleware } from '../_shared/admin.ts'
import { todayEat, toNairobiMinutes } from '../_shared/timezone.ts'

export async function handler(req: Request): Promise<Response> {
  const adminResult = await adminMiddleware(req, 'GET')
  if (adminResult instanceof Response) return adminResult

  const { userId: _userId, email: _email } = adminResult
  const supabase = createSupabaseAdmin()

  try {
    const url = new URL(req.url)
    const dateParam = url.searchParams.get('date') ?? todayEat()

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/
    if (!dateRegex.test(dateParam)) {
      return jsonResponse({ error: 'Invalid date format. Use YYYY-MM-DD' }, 400)
    }

    const [attendanceResult, totalResult] = await Promise.all([
      supabase
        .from('attendance')
        .select('status')
        .eq('attendance_date', dateParam),
      supabase
        .from('teachers')
        .select('id', { count: 'exact', head: true })
        .eq('employment_status', 'active'),
    ])

    if (attendanceResult.error) throw attendanceResult.error
    if (totalResult.error) throw totalResult.error

    const rows = attendanceResult.data ?? []
    const presentCount = rows.filter((r) => r.status === 'present' || r.status === 'checked_out').length
    const absentCount = rows.filter((r) => r.status === 'absent').length
    const lateCount = rows.filter((r) => r.status === 'late').length
    const checkedOutCount = rows.filter((r) => r.status === 'checked_out').length
    const totalTeachers = totalResult.count ?? 0

    const attendanceRate =
      totalTeachers && totalTeachers > 0
        ? Math.round(((presentCount ?? 0) + (lateCount ?? 0)) / totalTeachers * 100)
        : 0

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

    return jsonResponse({
      date: dateParam,
      present: presentCount,
      absent: absentCount ?? 0,
      late: lateCount ?? 0,
      checked_out: checkedOutCount ?? 0,
      total_teachers: totalTeachers ?? 0,
      attendance_rate: attendanceRate,
      avg_check_in_time: avgCheckIn,
      avg_working_minutes: avgWorkingMinutes,
    })
  } catch (err) {
    console.error('daily-report error:', err)
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      500
    )
  }
}

if (typeof Deno !== 'undefined' && typeof Deno.serve === 'function') {
  Deno.serve(handler)
}
