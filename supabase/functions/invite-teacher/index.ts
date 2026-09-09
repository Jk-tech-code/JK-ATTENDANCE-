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
  resend_email?: string
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

    // ── Resend invite mode ──────────────────────────────────────
    if (input.resend_email) {
      const existingAuthUser = await lookupAuthUserByEmail(
        supabaseUrl,
        serviceRoleKey,
        input.resend_email
      )
      if (!existingAuthUser) {
        return jsonResponse(
          { error: 'No account found for this email. Try creating a new teacher instead.' },
          404
        )
      }

      const { data: teacher } = await supabase
        .from('teachers')
        .select('id')
        .eq('email', input.resend_email)
        .maybeSingle()

      if (!teacher) {
        return jsonResponse(
          { error: 'No teacher record found for this email.' },
          404
        )
      }

      const siteUrl = Deno.env.get('SITE_URL') ?? 'https://jk-attendance.vercel.app'
      const { error: inviteError } = await supabase.auth.admin.inviteUserByEmail(
        input.resend_email,
        {
          redirectTo: `${siteUrl}/reset-password`,
          data: { role: 'teacher', full_name: input.full_name },
        }
      )

      if (inviteError) {
        console.error('[invite-teacher] Resend invite failed:', inviteError.message)
        return jsonResponse(
          { error: `Failed to resend invitation: ${inviteError.message}` },
          400
        )
      }

      await supabase
        .from('teachers')
        .update({
          invited_at: new Date().toISOString(),
          invitation_sent: true,
        })
        .eq('id', teacher.id)

      return jsonResponse({ message: 'Invitation resent successfully' }, 200)
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
      // inviteUserByEmail may create the auth user before failing on email delivery.
      // Clean up any orphaned auth user so retries don't hit duplicate-user errors.
      if (inviteData?.user?.id) {
        console.warn(
          '[invite-teacher] Cleaning up orphaned auth user:',
          inviteData.user.id
        )
        await supabase.auth.admin
          .deleteUser(inviteData.user.id)
          .catch((err: unknown) =>
            console.error('[invite-teacher] Cleanup deleteUser failed:', err)
          )
      }
      const msg = inviteError.message.toLowerCase()
      if (msg.includes('already') || msg.includes('duplicate') || msg.includes('exists')) {
        return jsonResponse({ error: 'A user with this email already exists.' }, 409)
      }
      return jsonResponse(
        { error: `Invitation email failed: ${inviteError.message}` },
        400
      )
    }
    if (!inviteData.user) {
      return jsonResponse({ error: 'Teacher account creation failed — no user returned.' }, 500)
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
      // Distinguish constraint violations (likely duplicates) from other errors
      const msg = teacherError.message.toLowerCase()
      if (msg.includes('duplicate') || msg.includes('unique') || msg.includes('already')) {
        return jsonResponse({ error: 'A teacher with this email or staff number already exists.' }, 409)
      }
      return jsonResponse({ error: 'Teacher record creation failed. Please try again.' }, 400)
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
