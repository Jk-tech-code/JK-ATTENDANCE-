import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { handleCors, jsonResponse } from "../_shared/cors.ts"
import { createSupabaseAdmin, verifyAuth } from "../_shared/supabase.ts"

interface NotificationPayload {
  teacher_id?: string
  attendance_date?: string
  type?: "missed_check_in" | "late_check_in" | "absent" | "reminder"
  custom_message?: string
}

Deno.serve(async (req: Request) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const auth = await verifyAuth(req.headers.get("Authorization"))
    if (auth.error) {
      return jsonResponse({ error: auth.error }, 401)
    }

    if (req.method === "GET") {
      const url = new URL(req.url)
      const teacherId = url.searchParams.get("teacher_id")
      const limit = parseInt(url.searchParams.get("limit") ?? "20")

      const supabase = createSupabaseAdmin()
      let query = supabase
        .from("attendance_notifications")
        .select("*, teacher:teachers(full_name, staff_number)")
        .order("created_at", { ascending: false })
        .limit(Math.min(limit, 100))

      if (teacherId) query = query.eq("teacher_id", teacherId)

      const { data, error } = await query
      if (error) throw error

      return jsonResponse({ notifications: data })
    }

    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405)
    }

    const payload: NotificationPayload = await req.json()
    const supabase = createSupabaseAdmin()

    const today = new Date().toISOString().slice(0, 10)
    const date = payload.attendance_date ?? today

    if (payload.type === "missed_check_in" || payload.type === "late_check_in") {
      let teachersToNotify: { id: string; full_name: string; email: string }[] = []

      if (payload.teacher_id) {
        const { data: teacher } = await supabase
          .from("teachers")
          .select("id, full_name, email")
          .eq("id", payload.teacher_id)
          .eq("employment_status", "active")
          .single()

        if (teacher) teachersToNotify = [teacher]
      } else {
        let query = supabase
          .from("teachers")
          .select("id, full_name, email")
          .eq("employment_status", "active")

        const { data: allTeachers } = await query
        if (!allTeachers) throw new Error("Failed to fetch teachers")

        for (const teacher of allTeachers) {
          const { data: att } = await supabase
            .from("attendance")
            .select("id, status")
            .eq("teacher_id", teacher.id)
            .eq("attendance_date", date)
            .maybeSingle()

          if (!att) {
            teachersToNotify.push(teacher)
          } else if (
            payload.type === "late_check_in" &&
            att.status === "late"
          ) {
            teachersToNotify.push(teacher)
          }
        }
      }

      const messages = teachersToNotify.map((t) => {
        const message =
          payload.custom_message ??
          (payload.type === "late_check_in"
            ? `Reminder: You checked in late today (${date}). Please ensure timely arrival.`
            : `Reminder: You have not checked in today (${date}). Please check in as soon as possible.`)

        return {
          teacher_id: t.id,
          type: payload.type,
          message,
          date,
          channel: "email",
          status: "pending" as const,
        }
      })

      if (messages.length > 0) {
        const { error: insertErr } = await supabase
          .from("attendance_notifications")
          .insert(messages)

        if (insertErr) throw insertErr
      }

      return jsonResponse({
        success: true,
        message: `${messages.length} notification(s) created`,
        notifications_created: messages.length,
        teachers_notified: teachersToNotify.map((t) => ({
          id: t.id,
          name: t.full_name,
          email: t.email,
        })),
      })
    }

    const message =
      payload.custom_message ??
      (() => {
        switch (payload.type) {
          case "absent":
            return `Absent marked for ${date}.`
          case "reminder":
            return `Attendance reminder for ${date}.`
          default:
            return `Notification for attendance on ${date}.`
        }
      })()

    const notification = {
      teacher_id: payload.teacher_id ?? null,
      type: payload.type ?? "reminder",
      message,
      date,
      channel: "email",
      status: "pending",
    }

    const { data: inserted, error: insertErr } = await supabase
      .from("attendance_notifications")
      .insert(notification)
      .select()
      .single()

    if (insertErr) throw insertErr

    return jsonResponse(
      {
        success: true,
        message: "Notification created",
        notification: inserted,
      },
      201
    )
  } catch (err) {
    console.error("attendance-notification error:", err)
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Internal server error" },
      500
    )
  }
})
