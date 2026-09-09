import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { adminMiddleware } from '../_shared/admin.ts'
import { jsonResponse } from '../_shared/cors.ts'

interface InviteInput {
  staff_number: string
  full_name: string
  email: string
  department?: string
  phone?: string
  reporting_time?: string
  employment_status?: string
}

function getEnv() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }
  return { supabaseUrl, serviceRoleKey }
}

function createSupabaseAdmin() {
  const { supabaseUrl, serviceRoleKey } = getEnv()
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function lookupAuthUserByEmail(
  supabaseUrl: string,
  serviceRoleKey: string,
  email: string
): Promise<{ id: string; email: string } | null> {
  const res = await fetch(`${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, {
    headers: { Authorization: `Bearer ${serviceRoleKey}` },
  })
  if (!res.ok) return null
  const users: Array<{ id: string; email: string }> = await res.json()
  return users.length > 0 ? users[0] : null
}

export async function handler(req: Request): Promise<Response> {
  const adminResult = await adminMiddleware(req, 'POST')
  if (adminResult instanceof Response) return adminResult

  const { supabaseUrl, serviceRoleKey } = getEnv()
  const supabase = createSupabaseAdmin()

  try {
    const input: InviteInput = await req.json()
    console.warn('[invite-teacher] Input:', {
      email: input.email,
      staff_number: input.staff_number,
      full_name: input.full_name,
    })

    if (!input.staff_number || !input.full_name || !input.email) {
      return jsonResponse({ error: 'staff_number, full_name, and email are required' }, 400)
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(input.email)) {
      return jsonResponse({ error: 'Please enter a valid email address' }, 400)
    }

    // Duplicate check: auth user
    const existingAuthUser = await lookupAuthUserByEmail(supabaseUrl, serviceRoleKey, input.email)
    if (existingAuthUser) {
      return jsonResponse({ error: 'This staff number or email is already registered' }, 409)
    }

    // Duplicate check: teachers table
    const { data: existingTeacher } = await supabase
      .from('teachers')
      .select('id')
      .or(`email.eq.${input.email},staff_number.eq.${input.staff_number}`)
      .maybeSingle()

    if (existingTeacher) {
      return jsonResponse({ error: 'This staff number or email is already registered' }, 409)
    }

    // Invite auth user via Supabase Auth (handles email delivery automatically)
    const siteUrl = Deno.env.get('SITE_URL') ?? 'https://jk-attendance.vercel.app'

    const { data: inviteData, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(
      input.email,
      {
        redirectTo: `${siteUrl}/reset-password`,
        data: { role: 'teacher', full_name: input.full_name },
      }
    )

    if (inviteError) {
      console.error('[invite-teacher] inviteUserByEmail failed:', inviteError.message)
      return jsonResponse({ error: 'Failed to create teacher account.' }, 400)
    }
    if (!inviteData.user) {
      return jsonResponse({ error: 'Failed to create teacher account — no user returned' }, 500)
    }

    const authUserId = inviteData.user.id

    // Create teacher record
    const { data: teacher, error: teacherError } = await supabase
      .from('teachers')
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
        employment_status: input.employment_status || 'active',
        role: 'teacher',
        invited_at: new Date().toISOString(),
        invitation_sent: true,
      })
      .select()
      .single()

    if (teacherError) {
      console.error(
        '[invite-teacher] Teacher insert failed, rolling back:',
        teacherError.message,
        teacherError.code
      )
      await supabase.auth.admin
        .deleteUser(authUserId)
        .catch((err: unknown) => console.error('[invite-teacher] Rollback deleteUser failed:', err))
      return jsonResponse({ error: 'Teacher record creation failed' }, 400)
    }

    return jsonResponse({ teacher }, 201)
  } catch (err) {
    console.error('[invite-teacher] Unhandled error:', err)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
}

if (typeof Deno !== 'undefined' && typeof Deno.serve === 'function') {
  Deno.serve(handler)
}
