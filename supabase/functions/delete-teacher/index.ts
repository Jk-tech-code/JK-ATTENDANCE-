import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { adminMiddleware } from '../_shared/admin.ts'
import { createSupabaseAdmin, jsonResponse } from '../_shared/supabase.ts'
import { checkRateLimit } from '../_shared/rate-limit.ts'

export async function handler(req: Request): Promise<Response> {
  const start = Date.now()

  const adminResult = await adminMiddleware(req, 'POST')
  if (adminResult instanceof Response) return adminResult

  const supabase = createSupabaseAdmin()

  // H2: distributed rate limit — 5 deletes per admin per minute, keyed by
  // the server-trusted admin user id (not IP). Fail-closed on limiter
  // backend failure.
  const rateLimit = await checkRateLimit(supabase, 'delete-teacher', adminResult.userId, 5, 60)
  if (!rateLimit.allowed) {
    return jsonResponse(
      { error: rateLimit.message },
      rateLimit.status,
      rateLimit.status === 429 ? { 'Retry-After': String(rateLimit.retryAfter) } : undefined
    )
  }

  try {
    const { teacher_id } = await req.json()
    if (!teacher_id) {
      return jsonResponse({ error: 'teacher_id is required' }, 400)
    }

    console.warn('[delete-teacher] Deleting teacher:', teacher_id)

    // Call SECURITY DEFINER function for atomic cascade delete
    const { data: result, error: fnError } = await supabase
      .rpc('delete_teacher_cascade', { p_teacher_id: teacher_id })
      .single()

    if (fnError) {
      console.error('[delete-teacher] RPC failed:', fnError.message)
      return jsonResponse({ error: 'Failed to delete teacher. Please try again.' }, 500)
    }

    if (!result?.success) {
      console.error('[delete-teacher] Cascade delete failed:', result?.error)
      return jsonResponse({ error: result?.error || 'Delete failed' }, 500)
    }

    const elapsed = Date.now() - start
    console.warn('[delete-teacher] Success in', elapsed, 'ms:', result)

    return jsonResponse({ success: true, result })
  } catch (err) {
    console.error('[delete-teacher] Unhandled error:', err)
    return jsonResponse({ error: 'An unexpected error occurred' }, 500)
  }
}

if (typeof Deno !== 'undefined' && typeof Deno.serve === 'function') {
  Deno.serve(handler)
}
