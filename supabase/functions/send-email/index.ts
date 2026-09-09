import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { jsonResponse } from '../_shared/cors.ts'
import { adminMiddleware } from '../_shared/admin.ts'

interface SendEmailInput {
  to: string
  subject: string
  html: string
  from?: string
}

function getResendApiKey(): string {
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) throw new Error('Missing RESEND_API_KEY')
  return key
}

function getFromAddress(): string {
  return Deno.env.get('EMAIL_FROM') ?? 'JK Attendance <noreply@jk-attendance.vercel.app>'
}

export async function handler(req: Request): Promise<Response> {
  const adminResult = await adminMiddleware(req, 'POST')
  if (adminResult instanceof Response) return adminResult

  try {
    const input: SendEmailInput = await req.json()

    if (!input.to || !input.subject || !input.html) {
      return jsonResponse({ error: 'to, subject, and html are required' }, 400)
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(input.to)) {
      return jsonResponse({ error: 'Invalid recipient email address' }, 400)
    }

    const resendApiKey = getResendApiKey()
    const from = input.from ?? getFromAddress()

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
      }),
    })

    const body = await res.json()

    if (!res.ok) {
      console.error('[send-email] Resend API error:', res.status, body)
      return jsonResponse(
        { error: `Failed to send email: ${body.message ?? res.statusText}` },
        res.status >= 500 ? 502 : res.status
      )
    }

    console.warn('[send-email] Email sent:', { id: body.id, to: input.to, subject: input.subject })
    return jsonResponse({ id: body.id, success: true }, 200)
  } catch (err) {
    console.error('[send-email] Unhandled error:', err)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
}

if (typeof Deno !== 'undefined' && typeof Deno.serve === 'function') {
  Deno.serve(handler)
}
