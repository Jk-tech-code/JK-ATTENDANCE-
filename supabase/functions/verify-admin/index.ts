import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { handleCors, jsonResponse } from "../_shared/cors.ts"
import { createSupabaseAdmin, verifyAuth, isAdmin } from "../_shared/supabase.ts"

Deno.serve(async (req: Request) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const auth = await verifyAuth(req.headers.get("Authorization"))
    if (auth.error) {
      return jsonResponse(
        { verified: false, error: auth.error },
        401
      )
    }

    const supabase = createSupabaseAdmin()
    const admin = await isAdmin(supabase)

    return jsonResponse({
      verified: admin,
      user_id: auth.user!.id,
      email: auth.user!.email,
      role: admin ? "admin" : "teacher",
      message: admin
        ? "Admin access verified"
        : "User is not an admin",
    })
  } catch (err) {
    console.error("verify-admin error:", err)
    return jsonResponse(
      { verified: false, error: err instanceof Error ? err.message : "Internal server error" },
      500
    )
  }
})
