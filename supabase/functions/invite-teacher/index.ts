import { createSupabaseAdmin, verifyAuth, isAdmin } from "../_shared/supabase.ts"
import { handleCors, jsonResponse } from "../_shared/cors.ts"

interface InviteInput {
  staff_number: string
  full_name: string
  email: string
  department?: string
  phone?: string
  reporting_time?: string
}

function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$"
  let password = ""
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return password
}

Deno.serve(async (req: Request) => {
  const start = Date.now()
  console.log("[invite-teacher] Received request:", {
    method: req.method,
    origin: req.headers.get("origin"),
    url: req.url,
  })

  const cors = handleCors(req)
  if (cors) return cors

  try {
    const auth = await verifyAuth(req.headers.get("Authorization"))
    if (!auth.user) {
      console.warn("[invite-teacher] Auth failed:", auth.error)
      return jsonResponse({ error: auth.error }, 401, req)
    }
    if (!isAdmin(auth.user)) {
      console.warn("[invite-teacher] Forbidden: user is not admin", auth.user.id)
      return jsonResponse({ error: "Only admins can invite teachers" }, 403, req)
    }

    const input: InviteInput = await req.json()
    console.log("[invite-teacher] Input:", { email: input.email, staff_number: input.staff_number, full_name: input.full_name })

    if (!input.staff_number || !input.full_name || !input.email) {
      return jsonResponse({ error: "staff_number, full_name, and email are required" }, 400, req)
    }

    const supabase = createSupabaseAdmin()
    const tempPassword = generatePassword()

    console.log("[invite-teacher] Creating auth user for:", input.email)
    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email: input.email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { role: "teacher", full_name: input.full_name },
    })

    if (authError) {
      console.error("[invite-teacher] Auth user creation failed:", authError.message)
      return jsonResponse({ error: authError.message }, 400, req)
    }
    if (!authUser.user) {
      console.error("[invite-teacher] Auth user creation returned null")
      return jsonResponse({ error: "Failed to create auth user" }, 500, req)
    }

    console.log("[invite-teacher] Auth user created:", authUser.user.id, ". Creating teacher record...")
    const { data: teacher, error: teacherError } = await supabase
      .from("teachers")
      .insert({
        id: authUser.user.id,
        user_id: authUser.user.id,
        staff_number: input.staff_number,
        full_name: input.full_name,
        email: input.email,
        department: input.department || null,
        phone: input.phone || null,
        reporting_time: input.reporting_time || null,
      })
      .select()
      .single()

    if (teacherError) {
      console.error("[invite-teacher] Teacher insert failed, rolling back auth user:", teacherError.message)
      await supabase.auth.admin.deleteUser(authUser.user.id)
      return jsonResponse({ error: teacherError.message }, 400, req)
    }

    const elapsed = Date.now() - start
    console.log("[invite-teacher] Success in", elapsed, "ms:", { teacher_id: teacher.id, email: input.email })

    return jsonResponse({ teacher, tempPassword }, 201, req)
  } catch (err) {
    console.error("[invite-teacher] Unhandled error:", err)
    return jsonResponse({ error: `Internal error: ${err.message}` }, 500, req)
  }
})
