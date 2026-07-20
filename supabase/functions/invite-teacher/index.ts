import { createClient } from "jsr:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("CORS_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

interface InviteInput {
  staff_number: string
  full_name: string
  email: string
  department?: string
  phone?: string
  reporting_time?: string
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
  console.log("[invite-teacher] Request:", { method: req.method, url: req.url, origin: req.headers.get("origin") })

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
    if (user.user_metadata?.role !== "admin") {
      return errorResponse({ error: "Only admins can invite teachers" }, 403)
    }

    const input: InviteInput = await req.json()
    console.log("[invite-teacher] Input:", { email: input.email, staff_number: input.staff_number, full_name: input.full_name })

    if (!input.staff_number || !input.full_name || !input.email) {
      return errorResponse({ error: "staff_number, full_name, and email are required" }, 400)
    }

    const siteUrl = Deno.env.get("SITE_URL") ?? "https://jkattendance.vercel.app"
    console.log("[invite-teacher] Inviting user via email:", input.email, "redirectTo:", `${siteUrl}/reset-password`)

    const { data: inviteData, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(input.email, {
      redirectTo: `${siteUrl}/reset-password`,
    })

    if (inviteError) {
      console.error("[invite-teacher] inviteUserByEmail failed:", inviteError.message)
      return errorResponse({ error: inviteError.message }, 400)
    }
    if (!inviteData.user) {
      return errorResponse({ error: "Invitation failed — no user returned" }, 500)
    }

    const authUserId = inviteData.user.id
    console.log("[invite-teacher] Auth user invited:", authUserId, ". Creating/linking teacher record...")

    const { data: teacher, error: teacherError } = await supabase
      .from("teachers")
      .insert({
        id: authUserId,
        user_id: authUserId,
        auth_user_id: authUserId,
        staff_number: input.staff_number,
        full_name: input.full_name,
        email: input.email,
        department: input.department || null,
        phone: input.phone || null,
        reporting_time: input.reporting_time || null,
        invited_at: new Date().toISOString(),
        invitation_sent: true,
      })
      .select()
      .single()

    if (teacherError) {
      console.error("[invite-teacher] Teacher insert failed, rolling back:", teacherError.message)
      await supabase.auth.admin.deleteUser(authUserId).catch(() => {})
      return errorResponse({ error: teacherError.message }, 400)
    }

    const elapsed = Date.now() - start
    console.log("[invite-teacher] Success in", elapsed, "ms:", { teacher_id: teacher.id, email: input.email })

    return new Response(JSON.stringify({ teacher }), {
      status: 201,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (err) {
    console.error("[invite-teacher] Unhandled error:", err)
    return errorResponse({ error: `Internal error: ${err.message}` }, 500)
  }
})
