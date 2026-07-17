import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { handleCors, jsonResponse } from "../_shared/cors.ts"
import { createSupabaseAdmin, verifyAuth } from "../_shared/supabase.ts"

Deno.serve(async (req: Request) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const auth = await verifyAuth(req.headers.get("Authorization"))
    if (auth.error) {
      return jsonResponse({ error: auth.error }, 401)
    }

    if (req.method !== "GET") {
      return jsonResponse({ error: "Method not allowed" }, 405)
    }

    const url = new URL(req.url)
    const dateParam = url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10)

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/
    if (!dateRegex.test(dateParam)) {
      return jsonResponse({ error: "Invalid date format. Use YYYY-MM-DD." }, 400)
    }

    const supabase = createSupabaseAdmin()
    const { data, error } = await supabase.rpc("check_calendar_date", {
      p_date: dateParam,
    })

    if (error) throw error

    return jsonResponse(data)
  } catch (err) {
    console.error("calendar-check error:", err)
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Internal server error" },
      500
    )
  }
})
