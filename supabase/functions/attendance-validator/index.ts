import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { handleCors, jsonResponse } from "../_shared/cors.ts"
import {
  createSupabaseAdmin,
  verifyAuth,
} from "../_shared/supabase.ts"

interface ValidatorBody {
  teacher_id: string
  check_in?: string
  check_out?: string
  attendance_date: string
}

Deno.serve(async (req: Request) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const auth = await verifyAuth(req.headers.get("Authorization"))
    if (auth.error) {
      return jsonResponse({ error: auth.error }, 401)
    }

    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405)
    }

    const body: ValidatorBody = await req.json()

    if (!body.teacher_id || !body.attendance_date) {
      return jsonResponse(
        { error: "Missing required fields: teacher_id, attendance_date" },
        400
      )
    }

    const supabase = createSupabaseAdmin()

    const { data: teacher } = await supabase
      .from("teachers")
      .select("id, full_name, staff_number")
      .eq("id", body.teacher_id)
      .maybeSingle()

    if (!teacher) {
      return jsonResponse({ error: "Teacher not found" }, 404)
    }

    const { data: settings } = await supabase
      .from("school_settings")
      .select("reporting_start_time, grace_period_minutes, checkout_time")
      .eq("active", true)
      .maybeSingle()

    const reportingStart = settings?.reporting_start_time ?? "07:00"
    const graceMinutes = settings?.grace_period_minutes ?? 20
    const checkoutTime = settings?.checkout_time ?? "17:30"

    const parseTime = (t: string): { hour: number; minute: number } => {
      const [h, m] = t.split(":").map(Number)
      return { hour: h, minute: m }
    }

    const toMinutes = (t: string): number => {
      const p = parseTime(t)
      return p.hour * 60 + p.minute
    }

    const reportingStartMin = toMinutes(reportingStart)
    const graceEndMin = reportingStartMin + graceMinutes
    const checkoutTimeMin = toMinutes(checkoutTime)

    let attendanceStatus: string | null = null
    let lateMinutes: number | null = null
    let earlyDepartureMinutes: number | null = null
    let workingHours: string | null = null

    if (!body.check_in && !body.check_out) {
      attendanceStatus = "ABSENT"
    }

    if (body.check_in) {
      const checkInMin = toMinutes(body.check_in.substring(0, 5))

      if (checkInMin > graceEndMin) {
        attendanceStatus = "LATE"
        lateMinutes = checkInMin - graceEndMin
      } else {
        attendanceStatus = "PRESENT"
        lateMinutes = 0
      }
    }

    if (body.check_out) {
      const checkOutMin = toMinutes(body.check_out.substring(0, 5))

      if (checkOutMin < checkoutTimeMin) {
        attendanceStatus = "EARLY_DEPARTURE"
        earlyDepartureMinutes = checkoutTimeMin - checkOutMin
      }
    }

    if (body.check_in && body.check_out) {
      const checkInMin = toMinutes(body.check_in.substring(0, 5))
      const checkOutMin = toMinutes(body.check_out.substring(0, 5))

      if (checkOutMin >= checkoutTimeMin && checkInMin <= graceEndMin) {
        attendanceStatus = "COMPLETE_DAY"
      }

      const totalMinutes = checkOutMin - checkInMin
      if (totalMinutes > 0) {
        const hrs = Math.floor(totalMinutes / 60)
        const mins = totalMinutes % 60
        workingHours = `${hrs} hrs ${mins} mins`
      }
    }

    const result: Record<string, unknown> = {
      teacher: teacher.full_name,
      teacher_id: teacher.id,
      staff_number: teacher.staff_number,
      attendance_date: body.attendance_date,
      status: attendanceStatus,
    }

    if (body.check_in) result.check_in = body.check_in
    if (body.check_out) result.check_out = body.check_out
    if (lateMinutes !== null) result.late_minutes = lateMinutes
    if (earlyDepartureMinutes !== null)
      result.early_departure_minutes = earlyDepartureMinutes
    if (workingHours) result.working_hours = workingHours

    return jsonResponse({
      success: true,
      validated: result,
      config: {
        reporting_start_time: reportingStart,
        grace_period_minutes: graceMinutes,
        checkout_time: checkoutTime,
      },
    })
  } catch (err) {
    console.error("attendance-validator error:", err)
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Internal server error" },
      500
    )
  }
})
