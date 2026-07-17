import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { handleCors, jsonResponse } from "../_shared/cors.ts"
import {
  createSupabaseAdmin,
  verifyAuth,
} from "../_shared/supabase.ts"

interface RecordAttendanceBody {
  teacher_id: string
  attendance_date: string
  check_in?: string
  check_out?: string
  status: "present" | "late" | "absent" | "checked_out"
  latitude?: number
  longitude?: number
  device?: string
  browser?: string
  notes?: string
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

    const body: RecordAttendanceBody = await req.json()

    if (!body.teacher_id || !body.attendance_date || !body.status) {
      return jsonResponse(
        { error: "Missing required fields: teacher_id, attendance_date, status" },
        400
      )
    }

    const supabase = createSupabaseAdmin()

    const { data: existing } = await supabase
      .from("attendance")
      .select("id, check_in, check_out")
      .eq("teacher_id", body.teacher_id)
      .eq("attendance_date", body.attendance_date)
      .maybeSingle()

    if (existing) {
      if (existing.check_in && existing.check_out) {
        return jsonResponse(
          { error: "already_completed", message: "Attendance already fully recorded for this date" },
          409
        )
      }
      if (existing.check_in && body.check_in) {
        return jsonResponse(
          { error: "already_checked_in", message: "Teacher already checked in today" },
          409
        )
      }
    }

    let duration: number | null = null
    if (body.check_in && body.check_out) {
      const inTime = new Date(body.check_in).getTime()
      const outTime = new Date(body.check_out).getTime()
      if (outTime > inTime) {
        duration = Math.round((outTime - inTime) / 60000)
      }
    }

    const insertData: Record<string, unknown> = {
      teacher_id: body.teacher_id,
      attendance_date: body.attendance_date,
      status: body.status,
      latitude: body.latitude ?? null,
      longitude: body.longitude ?? null,
      device: body.device ?? null,
      browser: body.browser ?? null,
    }

    if (body.check_in) insertData.check_in = body.check_in
    if (body.check_out) insertData.check_out = body.check_out
    if (duration !== null) insertData.working_minutes = duration

    if (existing && !existing.check_in && body.check_in) {
      const { error: updateError } = await supabase
        .from("attendance")
        .update(insertData)
        .eq("id", existing.id)

      if (updateError) throw updateError

      const { data: updated } = await supabase
        .from("attendance")
        .select("*")
        .eq("id", existing.id)
        .single()

      return jsonResponse({
        success: true,
        message: "Attendance updated",
        attendance: updated,
      })
    }

    const { data: inserted, error: insertError } = await supabase
      .from("attendance")
      .insert(insertData)
      .select()
      .single()

    if (insertError) throw insertError

    return jsonResponse(
      {
        success: true,
        message: existing ? "Attendance updated" : "Attendance recorded",
        attendance: inserted,
      },
      201
    )
  } catch (err) {
    console.error("record-attendance error:", err)
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Internal server error" },
      500
    )
  }
})
