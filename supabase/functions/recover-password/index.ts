import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { handleCors, jsonResponse } from '../_shared/cors.ts'

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

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: 'Server configuration error' }, 500)
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

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
  } catch (err) {
    console.error('[recover-password] Unhandled error:', err)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
}

if (typeof Deno !== 'undefined' && typeof Deno.serve === 'function') {
  Deno.serve(handler)
}
