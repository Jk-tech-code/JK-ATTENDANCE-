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
import { timingSafeEqualStrings } from "../_shared/timing.ts"

export async function handler(req: Request): Promise<Response> {
  const cors = handleCors(req)
  if (cors) return cors

  const cronSecret = Deno.env.get("CRON_SECRET")
  if (!cronSecret) {
    console.error("CRON_SECRET environment variable is not set. Rejecting request.")
    return jsonResponse({ error: "Server misconfigured: CRON_SECRET not set" }, 500)
  }
  // Only accept the secret via the dedicated x-api-key header — never reuse
  // the Authorization header (which carries JWTs on every other function).
  const apiKey = req.headers.get("x-api-key")
  if (!apiKey || !timingSafeEqualStrings(apiKey, cronSecret)) {
    return jsonResponse({ error: "Unauthorized" }, 401)
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
}

if (typeof Deno !== "undefined" && typeof Deno.serve === "function") {
  console.log("process-end-of-day invoked")
  Deno.serve(handler)
}
