import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { handleCors, jsonResponse } from "../_shared/cors.ts"
import { createSupabaseAdmin, verifyAuth, isAdmin } from "../_shared/supabase.ts"

Deno.serve(async (req: Request) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const auth = await verifyAuth(req.headers.get("Authorization"))
    if (auth.error) {
      return jsonResponse({ error: auth.error }, 401)
    }

    if (!isAdmin(auth.user!)) {
      return jsonResponse({ error: "Forbidden: Admin access required" }, 403)
    }

    if (req.method !== "GET") {
      return jsonResponse({ error: "Method not allowed" }, 405)
    }

    const url = new URL(req.url)
    const year = parseInt(url.searchParams.get("year") ?? String(new Date().getFullYear()))
    const month = parseInt(url.searchParams.get("month") ?? String(new Date().getMonth() + 1))

    if (month < 1 || month > 12) {
      return jsonResponse({ error: "Invalid month: must be 1-12" }, 400)
    }

    const startDate = `${year}-${String(month).padStart(2, "0")}-01`
    const endDate = new Date(year, month, 0).toISOString().slice(0, 10)

    const supabase = createSupabaseAdmin()

    const { data: allAttendance, error: attErr } = await supabase
      .from("attendance")
      .select("teacher_id, status, check_in, check_out, working_minutes, late_minutes")
      .gte("attendance_date", startDate)
      .lte("attendance_date", endDate)

    if (attErr) throw attErr

    const { data: teachers, error: tErr } = await supabase
      .from("teachers")
      .select("id, full_name, staff_number")
      .eq("employment_status", "active")

    if (tErr) throw tErr

    const workingDays = allAttendance?.length ?? 0
    const presentCount = allAttendance?.filter((a) =>
      ["present", "checked_out"].includes(a.status ?? "")
    ).length ?? 0
    const lateCount = allAttendance?.filter((a) => a.status === "late").length ?? 0
    const absentCount = allAttendance?.filter((a) => a.status === "absent").length ?? 0

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
          ? Math.round((workingMinutes.reduce((a, b) => a + b, 0) / workingMinutes.length) * 10) /
            10
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
        ? Math.round(
            (allWorkingMinutes.reduce((a, b) => a + b, 0) / allWorkingMinutes.length) * 10
          ) / 10
        : 0

    return jsonResponse({
      year,
      month,
      summary: {
        total_teachers: teachers?.length ?? 0,
        working_days: Math.max(
          workingDays,
          endDate.slice(8)
            ? parseInt(endDate.slice(8))
            : 0
        ),
        present_days: presentCount,
        late_days: lateCount,
        absent_days: absentCount,
        attendance_percentage:
          (teachers?.length ?? 0) > 0
            ? Math.round(
                ((presentCount + lateCount) /
                  ((teachers?.length ?? 1) *
                    parseInt(endDate.slice(8) || "30"))) *
                  100
              )
            : 0,
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
