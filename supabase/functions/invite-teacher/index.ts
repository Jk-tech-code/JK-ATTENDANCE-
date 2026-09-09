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

/**
 * Look up an auth user by email via the GoTrue REST API.
 * Returns the user object if found, null otherwise.
 * Uses the server-side admin endpoint which supports email filtering
 * without enumerating all users.
 */
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

/**
 * Convert Supabase Auth invite error to user-friendly message.
 * Does not expose internal details.
 */
function getInviteErrorMessage(inviteError: { message: string }): string {
  const msg = inviteError.message.toLowerCase()

  // Email provider / SMTP issues
  if (msg.includes('smtp') || msg.includes('email provider') || msg.includes('mail')) {
    return 'Email service is not configured. Please contact the system administrator.'
  }

  // Rate limiting
  if (msg.includes('rate limit') || msg.includes('too many') || msg.includes('quota')) {
    return 'Too many invitation requests. Please wait a moment and try again.'
  }

  // Redirect URL issues
  if (msg.includes('redirect') || msg.includes('url') || msg.includes('allowed')) {
    return 'Invalid redirect URL configuration. Please contact the system administrator.'
  }

  // Email template issues
  if (msg.includes('template') || msg.includes('confirmation')) {
    return 'Email template error. Please contact the system administrator.'
  }

  // User already exists (should be caught by duplicate check, but defense in depth)
  if (
    msg.includes('already registered') ||
    msg.includes('already exists') ||
    msg.includes('duplicate')
  ) {
    return 'An account with this email already exists.'
  }

  // Invalid email
  if (msg.includes('invalid email') || msg.includes('malformed')) {
    return 'Please enter a valid email address.'
  }

  // Generic fallback - log the actual error for debugging but return safe message
  console.error('[invite-teacher] inviteUserByEmail failed:', inviteError.message)
  return 'Unable to send invitation. Please try again or contact support if the problem persists.'
}

export async function handler(req: Request): Promise<Response> {
  const adminResult = await adminMiddleware(req, 'POST')
  if (adminResult instanceof Response) return adminResult

  const { userId: _userId, email: _adminEmail } = adminResult
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

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(input.email)) {
      return jsonResponse({ error: 'Please enter a valid email address' }, 400)
    }

    // Duplicate check: auth user, teacher email, staff number
    // Use the GoTrue REST API directly because getUserByEmail() does not
    // exist in supabase-js. The GoTrue server supports ?email=<addr>
    // filtering which returns only the matching user (no enumeration).
    const existingAuthUser = await lookupAuthUserByEmail(supabaseUrl, serviceRoleKey, input.email)
    if (existingAuthUser) {
      return jsonResponse({ error: 'This staff number or email is already registered' }, 409)
    }

    const { data: existingTeacher } = await supabase
      .from('teachers')
      .select('id')
      .or(`email.eq.${input.email},staff_number.eq.${input.staff_number}`)
      .maybeSingle()

    if (existingTeacher) {
      return jsonResponse({ error: 'This staff number or email is already registered' }, 409)
    }

    // Create auth user via inviteUserByEmail
    const siteUrl = Deno.env.get('SITE_URL')
    if (!siteUrl) {
      console.warn('[invite-teacher] SITE_URL not set, using default fallback')
    }
    const effectiveSiteUrl = siteUrl ?? 'https://jk-attendance.vercel.app'
    const redirectTo = `${effectiveSiteUrl}/reset-password`

    console.warn('[invite-teacher] Inviting:', input.email, 'redirectTo:', redirectTo)

    const { data: inviteData, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(
      input.email,
      {
        redirectTo,
        data: { role: 'teacher', full_name: input.full_name },
      }
    )

    if (inviteError) {
      const userMessage = getInviteErrorMessage(inviteError)
      return jsonResponse({ error: userMessage }, 400)
    }
    if (!inviteData.user) {
      console.error('[invite-teacher] Invitation failed — no user returned')
      return jsonResponse({ error: 'Invitation failed — no user returned' }, 500)
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
        role: 'teacher',
        invited_at: new Date().toISOString(),
        invitation_sent: true,
      })
      .select()
      .single()

    if (teacherError) {
      console.error('[invite-teacher] Teacher insert failed, rolling back:', teacherError.message)
      await supabase.auth.admin.deleteUser(authUserId).catch(() => {})
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
