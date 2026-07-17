// ============================================
// JK Attendance - End-of-Day Edge Function
// ============================================
// Free-tier fallback for pg_cron.
// Trigger via external cron service (cron-job.org etc.):
//   POST /functions/v1/process-end-of-day
//   Headers: { apiKey: "<publishable_or_secret_key>" }
//
// Requires SUPABASE_SERVICE_ROLE_KEY in secrets for admin DB access.
// ============================================

import "@supabase/functions-js/edge-runtime.d.ts"
import { withSupabase } from "@supabase/server"

console.log("process-end-of-day invoked")

export default {
  fetch: withSupabase({ auth: ["secret"] }, async (req, ctx) => {
    try {
      const { error } = await ctx.supabaseAdmin.rpc("process_end_of_day")

      if (error) {
        console.error("process_end_of_day RPC failed:", error.message)
        return Response.json({ error: error.message }, { status: 500 })
      }

      console.log("process_end_of_day completed successfully")
      return Response.json({ success: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error"
      console.error("Unhandled error:", message)
      return Response.json({ error: message }, { status: 500 })
    }
  }),
}
