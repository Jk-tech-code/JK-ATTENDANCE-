import { createClient } from 'jsr:@supabase/supabase-js@2'

export function createSupabaseAdmin() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables')
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function verifyAuth(authHeader: string | null) {
  if (!authHeader?.startsWith('Bearer ')) {
    return { user: null, error: 'Missing or invalid Authorization header' }
  }

  const token = authHeader.slice(7)
  const supabase = createSupabaseAdmin()
  const { data, error } = await supabase.auth.getUser(token)

  if (error || !data.user) {
    return { user: null, error: 'Invalid or expired token' }
  }

  return { user: data.user, error: null }
}

/**
 * Checks whether the authenticated user has admin role by querying the
 * teachers table directly via the service_role client (bypasses RLS).
 * Does NOT use the is_admin() DB RPC because service_role clients have
 * no auth.uid() context, causing is_admin() to always return false.
 * Never reads JWT user_metadata for authorization.
 */
export async function isAdmin(
  supabase: ReturnType<typeof createSupabaseAdmin>,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('teachers')
    .select('id')
    .or(`id.eq.${userId},user_id.eq.${userId},auth_user_id.eq.${userId}`)
    .in('role', ['admin', 'superadmin'])
    .maybeSingle()

  if (error) {
    console.error('[isAdmin] Direct query failed:', error.message)
    return isAdminViaRpc(supabase)
  }
  return data !== null
}

/**
 * Fallback: checks admin status via the public.is_admin() SQL function.
 * NOTE: is_admin() uses auth.uid() which is null for service_role clients.
 * This always returns false when called with service_role. Kept for
 * backwards compatibility but the direct query in isAdmin() is preferred.
 */
export async function isAdminViaRpc(
  _supabase: ReturnType<typeof createSupabaseAdmin>
): Promise<boolean> {
  // service_role clients have no auth.uid(), so is_admin() always returns false.
  // Return false directly to avoid a wasted RPC call.
  return false
}

export { jsonResponse } from './cors.ts'
