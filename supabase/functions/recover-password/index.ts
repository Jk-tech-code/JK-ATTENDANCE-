import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { jsonResponse } from '../_shared/cors.ts'

interface RecoverInput {
  email: string
}

function buildRecoveryEmailHtml(resetLink: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:system-ui,-apple-system,sans-serif;">
  <div style="max-width:480px;margin:40px auto;background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.1);overflow:hidden;">
    <div style="background:#1a1a2e;padding:24px;text-align:center;">
      <h1 style="color:#fff;margin:0;font-size:20px;">JK Attendance System</h1>
    </div>
    <div style="padding:32px 24px;">
      <h2 style="color:#1a1a2e;margin:0 0 16px;font-size:18px;">Reset your password</h2>
      <p style="color:#52525b;line-height:1.6;margin:0 0 24px;">
        We received a request to reset your password. Click the button below to choose a new one.
      </p>
      <a href="${resetLink}" style="display:inline-block;background:#1a1a2e;color:#fff;text-decoration:none;padding:12px 32px;border-radius:6px;font-weight:600;margin:0 0 24px;">
        Reset Password
      </a>
      <p style="color:#a1a1aa;font-size:13px;line-height:1.5;margin:0;">
        If you didn't request this, you can safely ignore this email.<br><br>
        If the button doesn't work, copy and paste this link into your browser:<br>
        <a href="${resetLink}" style="color:#1a1a2e;word-break:break-all;">${resetLink}</a>
      </p>
    </div>
    <div style="background:#f4f4f5;padding:16px 24px;text-align:center;">
      <p style="color:#a1a1aa;font-size:12px;margin:0;">This link will expire in 1 hour.</p>
    </div>
  </div>
</body>
</html>`
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

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

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: 'Server configuration error' }, 500)
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Look up auth user by email
    const userRes = await fetch(
      `${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(input.email)}`,
      { headers: { Authorization: `Bearer ${serviceRoleKey}` } }
    )

    if (!userRes.ok) {
      // Don't reveal whether the email exists — return success regardless
      console.warn('[recover-password] User lookup failed:', userRes.status)
      return jsonResponse({
        success: true,
        message: 'If an account exists, a reset link has been sent.',
      })
    }

    const users: Array<{ id: string; email: string }> = await userRes.json()
    if (users.length === 0) {
      // Don't reveal whether the email exists
      return jsonResponse({
        success: true,
        message: 'If an account exists, a reset link has been sent.',
      })
    }

    // Generate recovery link
    const siteUrl = Deno.env.get('SITE_URL') ?? 'https://jk-attendance.vercel.app'

    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'recovery',
      email: input.email,
      options: { redirectTo: `${siteUrl}/reset-password` },
    })

    if (linkError || !linkData?.properties?.action_link) {
      console.error(
        '[recover-password] generateLink failed:',
        linkError?.message ?? 'no action_link'
      )
      // Still return success to not reveal errors
      return jsonResponse({
        success: true,
        message: 'If an account exists, a reset link has been sent.',
      })
    }

    const resetLink = linkData.properties.action_link

    // Send email via Resend
    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    if (!resendApiKey) {
      console.error('[recover-password] RESEND_API_KEY not set')
      return jsonResponse({ error: 'Email service not configured. Contact administrator.' }, 500)
    }

    const fromAddress =
      Deno.env.get('EMAIL_FROM') ?? 'JK Attendance <noreply@jk-attendance.vercel.app>'

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [input.email],
        subject: 'Reset your JK Attendance password',
        html: buildRecoveryEmailHtml(resetLink),
      }),
    })

    const emailBody = await res.json()

    if (!res.ok) {
      console.error('[recover-password] Resend API error:', res.status, emailBody)
      return jsonResponse({ error: 'Failed to send reset email. Please try again.' }, 502)
    }

    console.warn('[recover-password] Recovery email sent:', { id: emailBody.id, to: input.email })
    return jsonResponse({
      success: true,
      message: 'If an account exists, a reset link has been sent.',
    })
  } catch (err) {
    console.error('[recover-password] Unhandled error:', err)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
}

if (typeof Deno !== 'undefined' && typeof Deno.serve === 'function') {
  Deno.serve(handler)
}
