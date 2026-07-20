import { createClient } from "jsr:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("CORS_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function createSupabaseAdmin() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function errorResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

Deno.serve(async (req: Request) => {
  const start = Date.now()
  console.log("[delete-teacher] Request:", { method: req.method, url: req.url, origin: req.headers.get("origin") })

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return errorResponse({ error: "Method not allowed" }, 405)
  }

  try {
    const authHeader = req.headers.get("Authorization")
    if (!authHeader?.startsWith("Bearer ")) {
      return errorResponse({ error: "Missing or invalid Authorization header" }, 401)
    }

    const supabase = createSupabaseAdmin()
    const token = authHeader.slice(7)
    const { data: { user }, error: userError } = await supabase.auth.getUser(token)
    if (userError || !user) {
      return errorResponse({ error: "Invalid or expired token" }, 401)
    }
    const { data: adminCheck } = await supabase.rpc("is_admin").single()
    if (!adminCheck) {
      return errorResponse({ error: "Only admins can delete teachers" }, 403)
    }

    const { teacher_id } = await req.json()
    if (!teacher_id) {
      return errorResponse({ error: "teacher_id is required" }, 400)
    }

    console.log("[delete-teacher] Deleting teacher:", teacher_id)

    // Call SECURITY DEFINER function for atomic cascade delete
    const { data: result, error: fnError } = await supabase
      .rpc("delete_teacher_cascade", { p_teacher_id: teacher_id })
      .single()

    if (fnError) {
      console.error("[delete-teacher] RPC failed:", fnError.message)
      return errorResponse({ error: fnError.message }, 500)
    }

    if (!result?.success) {
      console.error("[delete-teacher] Cascade delete failed:", result?.error)
      return errorResponse({ error: result?.error || "Delete failed" }, 500)
    }

    const elapsed = Date.now() - start
    console.log("[delete-teacher] Success in", elapsed, "ms:", result)

    return new Response(JSON.stringify({ success: true, result }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (err) {
    console.error("[delete-teacher] Unhandled error:", err)
    return errorResponse({ error: `Internal error: ${err.message}` }, 500)
  }
})
