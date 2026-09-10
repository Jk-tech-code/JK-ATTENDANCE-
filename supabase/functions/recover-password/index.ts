import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { handleCors, jsonResponse } from '../_shared/cors.ts'
import { createSupabaseAdmin } from '../_shared/supabase.ts'
import { checkRateLimit, hmacIdentifier, coarseIpTag } from '../_shared/rate-limit.ts'

interface RecoverInput {
  email: string
}

export async function handler(req: Request): Promise<Response> {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    const input: RecoverInput = await req.json()

    if (!input.email) {
      return jsonResponse({ error: 'Email is required' }, 400)
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(input.email)) {
      return jsonResponse({ error: 'Please enter a valid email address' }, 400)
    }

    const supabase = createSupabaseAdmin()

    // ── H2: distributed rate limit ────────────────────────────────────────
    // Two independent buckets (both atomic, both fail-closed):
    //
    //   1. PRIMARY (authoritative): HMAC-SHA256(normalized email), 5/min.
    //      The email is server-normalized and hashed (raw addresses are
    //      never stored in limiter state). x-forwarded-for is deliberately
    //      NOT trusted as a security identity — it can be client-supplied,
    //      so rotating it must not grant fresh capacity for the same
    //      target. This bucket cannot be bypassed by header rotation.
    //
    //   2. SECONDARY (anti-spray): coarse best-effort network tag
    //      (/24 IPv4, /48 IPv6), 30/min. Only narrows coordinated spraying
    //      of many random addresses from one network; it is never the sole
    //      boundary and never gates a legitimate single recovery.
    //
    // Fail-closed: a limiter backend outage rejects the request instead of
    // allowing unlimited recovery emails.
    const emailKey = await hmacIdentifier(input.email.trim().toLowerCase())
    const ipTag = coarseIpTag(req.headers.get('x-forwarded-for'))
    const checks: Array<{ identifier: string; maxAttempts: number }> = [
      { identifier: emailKey, maxAttempts: 5 },
      { identifier: `net:${ipTag}`, maxAttempts: 30 },
    ]
    for (const c of checks) {
      const rateLimit = await checkRateLimit(
        supabase,
        'recover-password',
        c.identifier,
        c.maxAttempts,
        60
      )
      if (!rateLimit.allowed) {
        return jsonResponse(
          { error: rateLimit.message },
          rateLimit.status,
          rateLimit.status === 429 ? { 'Retry-After': String(rateLimit.retryAfter) } : undefined
        )
      }
    }

    const siteUrl = Deno.env.get('SITE_URL') ?? 'https://jk-attendance.vercel.app'

    // Use Supabase Auth's built-in password reset email delivery.
    // This sends the email via Supabase's default email service.
    const { error } = await supabase.auth.resetPasswordForEmail(input.email, {
      redirectTo: `${siteUrl}/reset-password`,
    })

    if (error) {
      console.error('[recover-password] resetPasswordForEmail failed:', error.message)
      // Don't reveal whether the email exists — return success regardless
    }

    return jsonResponse({
      success: true,
      message: 'If an account exists, a reset link has been sent.',
    })
  } catch {
    console.error('[recover-password] Unhandled error')
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
}

if (typeof Deno !== 'undefined' && typeof Deno.serve === 'function') {
  Deno.serve(handler)
}
