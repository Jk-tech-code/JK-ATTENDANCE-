// ============================================
// JK Attendance - Cron Report Generator
// ============================================
// Triggered by Supabase Cron or external cron service:
//   POST /functions/v1/cron-report
//   Body: { type: "daily" }  or { type: "monthly", year?: 2026, month?: 7 }
//
// Without body, defaults to today's daily report.
//
// Stores results in the report_store table for persistence and
// frontend queries. The report_store table is admin-read-only via RLS.
// ============================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createSupabaseAdmin } from "../_shared/supabase.ts"
import { handleCors, jsonResponse } from "../_shared/cors.ts"

console.log("cron-report invoked")

Deno.serve(async (req: Request) => {
  const cors = handleCors(req)
  if (cors) return cors

  // Optional: protect with CRON_SECRET (same pattern as process-end-of-day)
  const cronSecret = Deno.env.get("CRON_SECRET")
  if (cronSecret) {
    const authHeader =
      req.headers.get("x-api-key") ??
      req.headers.get("authorization")?.replace("Bearer ", "")
    if (authHeader !== cronSecret) {
      return jsonResponse({ error: "Unauthorized" }, 401)
    }
  }

  try {
    const supabase = createSupabaseAdmin()

    // Parse request body
    let body: { type?: string; year?: number; month?: number } = {}
    try {
      if (req.method === "POST") {
        body = await req.json()
      }
    } catch {
      // No body or invalid JSON — use defaults
    }

    const type = body.type ?? "daily"

    if (type === "daily") {
      const result = await generateDailyReport(supabase)
      await storeReport(supabase, "daily", result.date, result.date, result)
      return jsonResponse({ success: true, report: result })
    }

    if (type === "monthly") {
      const now = new Date()
      const year = body.year ?? now.getFullYear()
      const month = body.month ?? now.getMonth() + 1
      const result = await generateMonthlyReport(supabase, year, month)
      const periodStart = `${year}-${String(month).padStart(2, "0")}-01`
      const periodEnd = new Date(year, month, 0).toISOString().slice(0, 10)
      await storeReport(supabase, "monthly", periodStart, periodEnd, result)
      return jsonResponse({ success: true, report: result })
    }

    return jsonResponse({ error: `Unknown report type: ${type}` }, 400)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    console.error("cron-report error:", message)
    return jsonResponse({ error: message }, 500)
  }
})

// ─── Daily Report Generation ─────────────────────────────────
async function generateDailyReport(supabase: ReturnType<typeof createSupabaseAdmin>) {
  const dateParam = new Date().toISOString().slice(0, 10)

  const { count: presentCount } = await supabase
    .from("attendance")
    .select("id", { count: "exact" })
    .eq("attendance_date", dateParam)
    .in("status", ["present", "checked_out"])

  const { count: absentCount } = await supabase
    .from("attendance")
    .select("id", { count: "exact" })
    .eq("attendance_date", dateParam)
    .eq("status", "absent")

  const { count: lateCount } = await supabase
    .from("attendance")
    .select("id", { count: "exact" })
    .eq("attendance_date", dateParam)
    .eq("status", "late")

  const { count: checkedOutCount } = await supabase
    .from("attendance")
    .select("id", { count: "exact" })
    .eq("attendance_date", dateParam)
    .eq("status", "checked_out")

  const { count: totalTeachers } = await supabase
    .from("teachers")
    .select("id", { count: "exact" })
    .eq("employment_status", "active")

  const pCount = presentCount ?? 0
  const lCount = lateCount ?? 0
  const attendanceRate =
    totalTeachers && totalTeachers > 0
      ? Math.round(((pCount + lCount) / totalTeachers) * 100)
      : 0

  // Average check-in time and working minutes
  const { data: avgData } = await supabase
    .from("attendance")
    .select("check_in, working_minutes")
    .eq("attendance_date", dateParam)
    .not("check_in", "is", null)

  let avgCheckIn = "-"
  let avgWorkingMinutes = 0

  if (avgData && avgData.length > 0) {
    const times = avgData
      .map((r) => r.check_in)
      .filter(Boolean)
      .map((t) => {
        const d = new Date(t!)
        return d.getHours() * 60 + d.getMinutes()
      })

    if (times.length > 0) {
      const avgMinutes = Math.round(times.reduce((a, b) => a + b, 0) / times.length)
      const h = Math.floor(avgMinutes / 60)
      const m = avgMinutes % 60
      avgCheckIn = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
    }

    const workingMinutes = avgData
      .map((r) => r.working_minutes)
      .filter((m): m is number => m !== null)
    if (workingMinutes.length > 0) {
      avgWorkingMinutes = Math.round(
        workingMinutes.reduce((a, b) => a + b, 0) / workingMinutes.length,
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
  month: number,
) {
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`
  const endDate = new Date(year, month, 0).toISOString().slice(0, 10)

  const { data: allAttendance } = await supabase
    .from("attendance")
    .select("teacher_id, status, check_in, check_out, working_minutes, late_minutes")
    .gte("attendance_date", startDate)
    .lte("attendance_date", endDate)

  const { data: teachers } = await supabase
    .from("teachers")
    .select("id, full_name, staff_number")
    .eq("employment_status", "active")

  const presentCount =
    allAttendance?.filter((a) =>
      ["present", "checked_out"].includes(a.status ?? ""),
    ).length ?? 0
  const lateCount = allAttendance?.filter((a) => a.status === "late").length ?? 0
  const absentCount = allAttendance?.filter((a) => a.status === "absent").length ?? 0

  const teacherStats = (teachers ?? []).map((teacher) => {
    const records = allAttendance?.filter((a) => a.teacher_id === teacher.id) ?? []
    const present = records.filter((r) =>
      ["present", "checked_out"].includes(r.status ?? ""),
    ).length
    const late = records.filter((r) => r.status === "late").length
    const absent = records.filter((r) => r.status === "absent").length
    const total = records.length
    const workingMinutes = records
      .map((r) => r.working_minutes)
      .filter((m): m is number => m !== null)
    const avgHours =
      workingMinutes.length > 0
        ? Math.round(
            (workingMinutes.reduce((a, b) => a + b, 0) / workingMinutes.length) * 10,
          ) / 10
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
      ? Math.round(
          (allWorkingMinutes.reduce((a, b) => a + b, 0) / allWorkingMinutes.length) * 10,
        ) / 10
      : 0

  return {
    year,
    month,
    period_start: startDate,
    period_end: endDate,
    summary: {
      total_teachers: teachers?.length ?? 0,
      present_days: presentCount,
      late_days: lateCount,
      absent_days: absentCount,
      attendance_percentage:
        (teachers?.length ?? 0) > 0
          ? Math.round(((presentCount + lateCount) / (teachers?.length ?? 1)) * 100)
          : 0,
      avg_working_hours: overallAvgHours,
    },
    teachers: teacherStats,
  }
}

// ─── Store report in report_store table ──────────────────────
async function storeReport(
  supabase: ReturnType<typeof createSupabaseAdmin>,
  reportType: string,
  periodStart: string,
  periodEnd: string,
  data: Record<string, unknown>,
) {
  const { error } = await supabase.from("report_store").insert({
    report_type: reportType,
    period_start: periodStart,
    period_end: periodEnd,
    data,
  })

  if (error) {
    console.error(`Failed to store ${reportType} report:`, error.message)
  }
}
