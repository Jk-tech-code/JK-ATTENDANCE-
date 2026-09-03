import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { adminMiddleware } from "../_shared/admin.ts"
import { createSupabaseAdmin, jsonResponse } from "../_shared/supabase.ts"

Deno.serve(async (req: Request) => {
  const start = Date.now()
  console.log("[delete-teacher] Request:", { method: req.method, url: req.url, origin: req.headers.get("origin") })

  const adminResult = await adminMiddleware(req, "POST")
  if (adminResult instanceof Response) return adminResult

  const { userId: _userId, email: _adminEmail } = adminResult
  const supabase = createSupabaseAdmin()

  try {
    const { teacher_id } = await req.json()
    if (!teacher_id) {
      return jsonResponse({ error: "teacher_id is required" }, 400)
    }

    console.log("[delete-teacher] Deleting teacher:", teacher_id)

    // Call SECURITY DEFINER function for atomic cascade delete
    const { data: result, error: fnError } = await supabase
      .rpc("delete_teacher_cascade", { p_teacher_id: teacher_id })
      .single()

    if (fnError) {
      console.error("[delete-teacher] RPC failed:", fnError.message)
      return jsonResponse({ error: "Failed to delete teacher. Please try again." }, 500)
    }

    if (!result?.success) {
      console.error("[delete-teacher] Cascade delete failed:", result?.error)
      return jsonResponse({ error: result?.error || "Delete failed" }, 500)
    }

    const elapsed = Date.now() - start
    console.log("[delete-teacher] Success in", elapsed, "ms:", result)

    return jsonResponse({ success: true, result })
  } catch (err) {
    console.error("[delete-teacher] Unhandled error:", err)
    return jsonResponse({ error: "An unexpected error occurred" }, 500)
  }
})
