import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import { adminMiddleware } from "../_shared/admin.ts"
import { jsonResponse } from "../_shared/cors.ts"

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

Deno.serve(async (req: Request) => {
  const start = Date.now()
  console.log("[invite-teacher] Request:", { method: req.method, url: req.url, origin: req.headers.get("origin") })

  const adminResult = await adminMiddleware(req, "POST")
  if (adminResult instanceof Response) return adminResult

  const { userId: _userId, email: _adminEmail } = adminResult
  const supabase = createSupabaseAdmin()

  try {
    const input: InviteInput = await req.json()
    console.log("[invite-teacher] Input:", { email: input.email, staff_number: input.staff_number, full_name: input.full_name })

    if (!input.staff_number || !input.full_name || !input.email) {
      return jsonResponse({ error: "staff_number, full_name, and email are required" }, 400)
    }

    // Duplicate check: auth user, teacher email, staff number
    // FIX: Use getUserByEmail instead of listUsers to prevent email enumeration
    // listUsers() returns ALL users - an attacker can enumerate valid emails
    // getUserByEmail() only returns the specific user if they exist (or 404)
    const { data: existingAuthUser, error: getUserError } = await supabase.auth.admin.getUserByEmail(input.email)
    if (getUserError && getUserError.status !== 404) {
      // Unexpected error - log but don't reveal whether email exists
      console.error("[invite-teacher] getUserByEmail error:", getUserError.message)
    }
    if (existingAuthUser?.user) {
      return jsonResponse({ error: "This staff number or email is already registered" }, 409)
    }

    const { data: existingTeacher } = await supabase
      .from("teachers")
      .select("id")
      .or(`email.eq.${input.email},staff_number.eq.${input.staff_number}`)
      .maybeSingle()

    if (existingTeacher) {
      return jsonResponse({ error: "This staff number or email is already registered" }, 409)
    }

    // Create auth user via inviteUserByEmail
    const siteUrl = Deno.env.get("SITE_URL") ?? "https://jkattendance.vercel.app"
    console.log("[invite-teacher] Inviting:", input.email, "redirectTo:", `${siteUrl}/reset-password`)

    const { data: inviteData, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(input.email, {
      redirectTo: `${siteUrl}/reset-password`,
      data: { role: "teacher", full_name: input.full_name },
    })

    if (inviteError) {
      console.error("[invite-teacher] inviteUserByEmail failed:", inviteError.message)
      return jsonResponse({ error: inviteError.message }, 400)
    }
    if (!inviteData.user) {
      return jsonResponse({ error: "Invitation failed — no user returned" }, 500)
    }

    const authUserId = inviteData.user.id

    // Create teacher record
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
        role: 'teacher',
        invited_at: new Date().toISOString(),
        invitation_sent: true,
      })
      .select()
      .single()

    if (teacherError) {
      console.error("[invite-teacher] Teacher insert failed, rolling back:", teacherError.message)
      await supabase.auth.admin.deleteUser(authUserId).catch(() => {})
      return jsonResponse({ error: teacherError.message }, 400)
    }

    const elapsed = Date.now() - start
    console.log("[invite-teacher] Success in", elapsed, "ms:", { teacher_id: teacher.id, email: input.email })

    return jsonResponse({ teacher }, 201)
  } catch (err) {
    console.error("[invite-teacher] Unhandled error:", err)
    return jsonResponse({ error: `Internal error: ${err.message}` }, 500)
  }
})
