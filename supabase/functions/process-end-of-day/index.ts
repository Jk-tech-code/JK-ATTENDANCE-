// ============================================
// JK Attendance - End-of-Day Edge Function
// ============================================
// Free-tier fallback for pg_cron.
// Trigger via external cron service (cron-job.org etc.):
//   POST /functions/v1/process-end-of-day
//
// Requires SUPABASE_SERVICE_ROLE_KEY in secrets for admin DB access.
// ============================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createSupabaseAdmin } from "../_shared/supabase.ts"
import { handleCors, jsonResponse } from "../_shared/cors.ts"

console.log("process-end-of-day invoked")

Deno.serve(async (req: Request) => {
  const cors = handleCors(req)
  if (cors) return cors

  const cronSecret = Deno.env.get("CRON_SECRET")
  if (cronSecret) {
    const authHeader = req.headers.get("x-api-key") ?? req.headers.get("authorization")?.replace("Bearer ", "")
    if (authHeader !== cronSecret) {
      return jsonResponse({ error: "Unauthorized" }, 401)
    }
  }

  try {
    const supabase = createSupabaseAdmin()

    const { error } = await supabase.rpc("process_end_of_day")

    if (error) {
      console.error("process_end_of_day RPC failed:", error.message)
      return jsonResponse({ error: error.message }, 500)
    }

    console.log("process_end_of_day completed successfully")
    return jsonResponse({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    console.error("Unhandled error:", message)
    return jsonResponse({ error: message }, 500)
  }
})
