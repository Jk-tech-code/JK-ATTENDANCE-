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
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const auth = await verifyAuth(req.headers.get("Authorization"))
    if (!auth.user) {
      return jsonResponse({ error: auth.error }, 401, req)
    }
    if (!isAdmin(auth.user)) {
      return jsonResponse({ error: "Only admins can invite teachers" }, 403, req)
    }

    const input: InviteInput = await req.json()
    if (!input.staff_number || !input.full_name || !input.email) {
      return jsonResponse({ error: "staff_number, full_name, and email are required" }, 400, req)
    }

    const supabase = createSupabaseAdmin()
    const tempPassword = generatePassword()

    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email: input.email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { role: "teacher", full_name: input.full_name },
    })

    if (authError) {
      return jsonResponse({ error: authError.message }, 400, req)
    }
    if (!authUser.user) {
      return jsonResponse({ error: "Failed to create auth user" }, 500, req)
    }

    const { data: teacher, error: teacherError } = await supabase
      .from("teachers")
      .insert({
        id: authUser.user.id,
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
      await supabase.auth.admin.deleteUser(authUser.user.id)
      return jsonResponse({ error: teacherError.message }, 400, req)
    }

    return jsonResponse({ teacher, tempPassword }, 201, req)
  } catch (err) {
    return jsonResponse({ error: `Internal error: ${err.message}` }, 500, req)
  }
})
