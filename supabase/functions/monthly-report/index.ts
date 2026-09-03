import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { jsonResponse } from "../_shared/cors.ts"
import { createSupabaseAdmin } from "../_shared/supabase.ts"
import { adminMiddleware } from "../_shared/admin.ts"

Deno.serve(async (req: Request) => {
  const adminResult = await adminMiddleware(req, "GET")
  if (adminResult instanceof Response) return adminResult

  const { userId: _userId, email: _email } = adminResult
  const supabase = createSupabaseAdmin()

  try {
    const url = new URL(req.url)
    const year = parseInt(url.searchParams.get("year") ?? String(new Date().getFullYear()))
    const month = parseInt(url.searchParams.get("month") ?? String(new Date().getMonth() + 1))

    if (month < 1 || month > 12) {
      return jsonResponse({ error: "Invalid month: must be 1-12" }, 400)
    }

    const startDate = `${year}-${String(month).padStart(2, "0")}-01`
    const endDate = new Date(year, month, 0).toISOString().slice(0, 10)
    const daysInMonth = new Date(year, month, 0).getDate()

    const [{ data: holidays }, { data: allAttendance }, { data: teachers }] = await Promise.all([
      supabase.from("school_holidays").select("date").gte("date", startDate).lte("date", endDate),
      supabase.from("attendance").select("teacher_id, status, check_in, check_out, working_minutes, late_minutes").gte("attendance_date", startDate).lte("attendance_date", endDate),
      supabase.from("teachers").select("id, full_name, staff_number").eq("employment_status", "active"),
    ])

    const holidayDates = new Set((holidays ?? []).map((h: { date: string }) => h.date))
    const workingDays = Math.max(0, daysInMonth - holidayDates.size)

    const presentCount = allAttendance?.filter((a) =>
      ["present", "checked_out"].includes(a.status ?? "")
    ).length ?? 0
    const lateCount = allAttendance?.filter((a) => a.status === "late").length ?? 0
    const absentCount = allAttendance?.filter((a) => a.status === "absent").length ?? 0

    const teacherCount = teachers?.length ?? 0
    const totalPossibleAttendance = teacherCount * workingDays
    const summaryAttendancePercentage =
      totalPossibleAttendance > 0
        ? Math.round(((presentCount + lateCount) / totalPossibleAttendance) * 100)
        : 0

    const teacherStats = (teachers ?? []).map((teacher) => {
      const records = allAttendance?.filter((a) => a.teacher_id === teacher.id) ?? []
      const total = records.length
      const present = records.filter((r) =>
        ["present", "checked_out"].includes(r.status ?? "")
      ).length
      const late = records.filter((r) => r.status === "late").length
      const absent = records.filter((r) => r.status === "absent").length
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
        attendance_percentage:
          total > 0 ? Math.round(((present + late) / total) * 100) : 0,
        avg_working_hours: avgHours,
      }
    })

    const allWorkingMinutes = allAttendance
      ?.map((a) => a.working_minutes)
      .filter((m): m is number => m !== null)
    const overallAvgHours =
      allWorkingMinutes && allWorkingMinutes.length > 0
        ? Math.round(allWorkingMinutes.reduce((a, b) => a + b, 0) / allWorkingMinutes.length * 10) / 10
        : 0

    return jsonResponse({
      year,
      month,
      summary: {
        total_teachers: teacherCount,
        working_days: workingDays,
        present_days: presentCount,
        late_days: lateCount,
        absent_days: absentCount,
        attendance_percentage: summaryAttendancePercentage,
        avg_working_hours: overallAvgHours,
      },
      teachers: teacherStats,
    })
  } catch (err) {
    console.error("monthly-report error:", err)
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Internal server error" },
      500
    )
  }
})
