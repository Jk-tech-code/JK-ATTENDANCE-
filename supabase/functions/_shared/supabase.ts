import { createClient } from "jsr:@supabase/supabase-js@2"

export function createSupabaseAdmin() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables"
    )
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function verifyAuth(authHeader: string | null) {
  if (!authHeader?.startsWith("Bearer ")) {
    return { user: null, error: "Missing or invalid Authorization header" }
  }

  const token = authHeader.slice(7)
  const supabase = createSupabaseAdmin()
  const { data, error } = await supabase.auth.getUser(token)

  if (error || !data.user) {
    return { user: null, error: "Invalid or expired token" }
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
    .from("teachers")
    .select("id")
    .or(`id.eq.${userId},user_id.eq.${userId},auth_user_id.eq.${userId}`)
    .eq("role", "admin")
    .maybeSingle()

  if (error) {
    console.error("[isAdmin] Query failed:", error.message)
    return false
  }
  return data !== null
}

export function getUserRole(_user: { user_metadata?: Record<string, unknown> }): string {
  return "teacher"
}
