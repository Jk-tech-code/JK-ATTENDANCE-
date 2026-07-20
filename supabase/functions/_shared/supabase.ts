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
 * Checks whether the authenticated user has admin role by querying
 * the teachers table via the SECURITY DEFINER function is_admin().
 * Never reads JWT user_metadata for authorization.
 */
export async function isAdmin(supabase: ReturnType<typeof createSupabaseAdmin>): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_admin")
  if (error) {
    console.error("[isAdmin] RPC call failed:", error.message)
    return false
  }
  return data === true
}

export function getUserRole(_user: { user_metadata?: Record<string, unknown> }): string {
  return "teacher"
}
