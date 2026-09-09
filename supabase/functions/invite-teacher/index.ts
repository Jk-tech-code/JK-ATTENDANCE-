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

function buildInviteEmailHtml(fullName: string, inviteLink: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:system-ui,-apple-system,sans-serif;">
  <div style="max-width:480px;margin:40px auto;background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.1);overflow:hidden;">
    <div style="background:#1a1a2e;padding:24px;text-align:center;">
      <h1 style="color:#fff;margin:0;font-size:20px;">JK Attendance System</h1>
    </div>
    <div style="padding:32px 24px;">
      <h2 style="color:#1a1a2e;margin:0 0 16px;font-size:18px;">You're invited!</h2>
      <p style="color:#52525b;line-height:1.6;margin:0 0 24px;">
        Hi ${fullName},<br><br>
        An administrator has created an account for you on the JK Attendance System.
        Click the button below to set your password and get started.
      </p>
      <a href="${inviteLink}" style="display:inline-block;background:#1a1a2e;color:#fff;text-decoration:none;padding:12px 32px;border-radius:6px;font-weight:600;margin:0 0 24px;">
        Set Your Password
      </a>
      <p style="color:#a1a1aa;font-size:13px;line-height:1.5;margin:0;">
        If the button doesn't work, copy and paste this link into your browser:<br>
        <a href="${inviteLink}" style="color:#1a1a2e;word-break:break-all;">${inviteLink}</a>
      </p>
    </div>
    <div style="background:#f4f4f5;padding:16px 24px;text-align:center;">
      <p style="color:#a1a1aa;font-size:12px;margin:0;">This link will expire in 24 hours.</p>
    </div>
  </div>
</body>
</html>`
}

async function sendInviteEmail(
  resendApiKey: string,
  to: string,
  fullName: string,
  inviteLink: string,
  fromAddress: string
): Promise<{ success: boolean; error?: string }> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromAddress,
      to: [to],
      subject: 'Set up your JK Attendance account',
      html: buildInviteEmailHtml(fullName, inviteLink),
    }),
  })

  const body = await res.json()

  if (!res.ok) {
    console.error('[invite-teacher] Resend API error:', res.status, body)
    return { success: false, error: body.message ?? `Resend API error: ${res.status}` }
  }

  console.warn('[invite-teacher] Email sent via Resend:', { id: body.id, to })
  return { success: true }
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

    // Step 1: Create auth user (no email sent)
    const { data: userData, error: userError } = await supabase.auth.admin.createUser({
      email: input.email,
      email_confirm: true,
      user_metadata: { role: 'teacher', full_name: input.full_name },
    })

    if (userError) {
      console.error('[invite-teacher] createUser failed:', userError.message)
      if (userError.message.includes('already') || userError.message.includes('duplicate')) {
        return jsonResponse({ error: 'An account with this email already exists.' }, 409)
      }
      return jsonResponse({ error: 'Failed to create teacher account.' }, 400)
    }
    if (!userData.user) {
      return jsonResponse({ error: 'Failed to create teacher account — no user returned' }, 500)
    }

    const authUserId = userData.user.id

    // Step 2: Generate invite link
    const siteUrl = Deno.env.get('SITE_URL')
    if (!siteUrl) {
      console.warn('[invite-teacher] SITE_URL not set, using default fallback')
    }
    const effectiveSiteUrl = siteUrl ?? 'https://jk-attendance.vercel.app'

    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: input.email,
      options: { redirectTo: `${effectiveSiteUrl}/reset-password` },
    })

    if (linkError || !linkData?.properties?.action_link) {
      console.error('[invite-teacher] generateLink failed:', linkError?.message ?? 'no action_link')
      console.error('[invite-teacher] linkData:', JSON.stringify(linkData, null, 2))
      // Rollback: delete the auth user
      await supabase.auth.admin
        .deleteUser(authUserId)
        .catch((err: unknown) => console.error('[invite-teacher] Rollback deleteUser failed:', err))
      return jsonResponse({ error: 'Failed to generate invitation link.' }, 400)
    }

    const inviteLink = linkData.properties.action_link

    // Step 3: Send email via Resend
    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    if (!resendApiKey) {
      console.error('[invite-teacher] RESEND_API_KEY not set')
      // Rollback: delete the auth user
      await supabase.auth.admin
        .deleteUser(authUserId)
        .catch((err: unknown) => console.error('[invite-teacher] Rollback deleteUser failed:', err))
      return jsonResponse({ error: 'Email service not configured. Contact administrator.' }, 500)
    }

    const fromAddress =
      Deno.env.get('EMAIL_FROM') ?? 'JK Attendance <noreply@jk-attendance.vercel.app>'
    const emailResult = await sendInviteEmail(
      resendApiKey,
      input.email,
      input.full_name,
      inviteLink,
      fromAddress
    )

    if (!emailResult.success) {
      console.error('[invite-teacher] Email send failed:', emailResult.error)
      // Rollback: delete the auth user
      await supabase.auth.admin
        .deleteUser(authUserId)
        .catch((err: unknown) => console.error('[invite-teacher] Rollback deleteUser failed:', err))
      return jsonResponse({ error: `Failed to send invitation email: ${emailResult.error}` }, 500)
    }

    // Step 4: Create teacher record
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
