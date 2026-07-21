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

    const supabase = createSupabaseAdmin()

    if (!(await isAdmin(supabase, auth.user.id))) {
      return jsonResponse({ error: "Forbidden: Admin access required" }, 403)
    }

    if (req.method !== "GET") {
      return jsonResponse({ error: "Method not allowed" }, 405)
    }

    const url = new URL(req.url)
    const dateParam = url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10)

    const { data: present, error: presentErr } = await supabase
      .from("attendance")
      .select("id", { count: "exact" })
      .eq("attendance_date", dateParam)
      .in("status", ["present", "checked_out"])

    if (presentErr) throw presentErr

    const { count: absentCount, error: absentErr } = await supabase
      .from("attendance")
      .select("id", { count: "exact" })
      .eq("attendance_date", dateParam)
      .eq("status", "absent")

    if (absentErr) throw absentErr

    const { count: lateCount, error: lateErr } = await supabase
      .from("attendance")
      .select("id", { count: "exact" })
      .eq("attendance_date", dateParam)
      .eq("status", "late")

    if (lateErr) throw lateErr

    const { count: checkedOutCount, error: coErr } = await supabase
      .from("attendance")
      .select("id", { count: "exact" })
      .eq("attendance_date", dateParam)
      .eq("status", "checked_out")

    if (coErr) throw coErr

    const { count: totalTeachers, error: totalErr } = await supabase
      .from("teachers")
      .select("id", { count: "exact" })
      .eq("employment_status", "active")

    if (totalErr) throw totalErr

    const presentCount = present?.length ?? 0
    const attendanceRate =
      totalTeachers && totalTeachers > 0
        ? Math.round(((presentCount + (lateCount ?? 0)) / totalTeachers) * 100)
        : 0

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
    console.error("daily-report error:", err)
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Internal server error" },
      500
    )
  }
})
