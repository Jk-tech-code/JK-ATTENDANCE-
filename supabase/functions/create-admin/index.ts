import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { adminMiddleware } from '../_shared/admin.ts'
import { createSupabaseAdmin, jsonResponse } from '../_shared/supabase.ts'
import { checkRateLimit } from '../_shared/rate-limit.ts'

interface CreateAdminInput {
  email: string
  full_name: string
  role: 'admin' | 'superadmin'
}

/**
 * Look up an auth user by email via the GoTrue REST API.
 * Returns the user object if found, null otherwise.
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

export async function handler(req: Request): Promise<Response> {
  const adminResult = await adminMiddleware(req, 'POST')
  if (adminResult instanceof Response) return adminResult

  const { role: callerRole } = adminResult
  const supabase = createSupabaseAdmin()

  // H2: distributed rate limit — 3 admin creations per admin per minute,
  // keyed by the server-trusted admin user id (not IP, not request email).
  // Fail-closed: a limiter backend outage rejects the request (503) rather
  // than letting the sensitive operation run unlimited.
  const rateLimit = await checkRateLimit(supabase, 'create-admin', adminResult.userId, 3, 60)
  if (!rateLimit.allowed) {
    return jsonResponse(
      { error: rateLimit.message },
      rateLimit.status,
      rateLimit.status === 429 ? { 'Retry-After': String(rateLimit.retryAfter) } : undefined
    )
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  try {
    const input: CreateAdminInput = await req.json()

    // ── Input validation ──────────────────────────
    if (!input.email || !input.full_name || !input.role) {
      return jsonResponse({ error: 'email, full_name, and role are required' }, 400)
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(input.email)) {
      return jsonResponse({ error: 'Please enter a valid email address' }, 400)
    }

    const allowedRoles = ['admin', 'superadmin'] as const
    if (!allowedRoles.includes(input.role)) {
      return jsonResponse({ error: 'Invalid administrator role' }, 400)
    }

    // ── Server-side authorization ─────────────────
    // Admin cannot create Superadmin
    if (input.role === 'superadmin' && callerRole !== 'superadmin') {
      return jsonResponse(
        { error: 'You do not have permission to create a superadmin account' },
        403
      )
    }

    // ── Duplicate check: auth user ────────────────
    const existingAuthUser = await lookupAuthUserByEmail(supabaseUrl, serviceRoleKey, input.email)
    if (existingAuthUser) {
      return jsonResponse({ error: 'An account with this email already exists' }, 409)
    }

    // ── Duplicate check: teachers table ───────────
    const { data: existingTeacher } = await supabase
      .from('teachers')
      .select('id')
      .eq('email', input.email)
      .maybeSingle()

    if (existingTeacher) {
      return jsonResponse({ error: 'An account with this email already exists' }, 409)
    }

    // ── Duplicate check: profiles table ───────────
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', input.email)
      .maybeSingle()

    if (existingProfile) {
      return jsonResponse({ error: 'An account with this email already exists' }, 409)
    }

    // ── Create auth user via invite ───────────────
    const siteUrl = Deno.env.get('SITE_URL') ?? 'https://jk-attendance.vercel.app'
    console.warn('[create-admin] Creating admin:', input.role)

    const { data: inviteData, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(
      input.email,
      {
        redirectTo: `${siteUrl}/reset-password`,
        data: { role: input.role, full_name: input.full_name },
      }
    )

    if (inviteError) {
      console.error('[create-admin] inviteUserByEmail failed:', inviteError.message)
      return jsonResponse({ error: 'Unable to create the administrator account' }, 400)
    }
    if (!inviteData.user) {
      return jsonResponse({ error: 'Unable to create the administrator account' }, 500)
    }

    const authUserId = inviteData.user.id

    // ── Create teacher record with admin role ─────
    const { error: teacherError } = await supabase.from('teachers').insert({
      id: authUserId,
      user_id: authUserId,
      auth_user_id: authUserId,
      staff_number: `ADMIN-${authUserId.slice(0, 8)}`,
      full_name: input.full_name,
      email: input.email,
      role: input.role,
      invited_at: new Date().toISOString(),
      invitation_sent: true,
    })

    if (teacherError) {
      console.error('[create-admin] Teacher insert failed, rolling back:', teacherError.message)
      await supabase.auth.admin.deleteUser(authUserId).catch(() => {})
      return jsonResponse({ error: 'Administrator account creation failed' }, 500)
    }

    // ── Update profile role (created by handle_new_user trigger) ──
    const { error: profileError } = await supabase
      .from('profiles')
      .update({ role: input.role })
      .eq('id', authUserId)

    if (profileError) {
      console.error('[create-admin] Profile role update failed:', profileError.message)
      // Non-fatal: teacher record is the source of truth for authorization
    }

    console.warn('[create-admin] Success:', input.role)

    return jsonResponse(
      {
        admin: {
          id: authUserId,
          email: input.email,
          full_name: input.full_name,
          role: input.role,
        },
      },
      201
    )
  } catch (err) {
    console.error('[create-admin] Unhandled error:', err)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
}

if (typeof Deno !== 'undefined' && typeof Deno.serve === 'function') {
  Deno.serve(handler)
}
