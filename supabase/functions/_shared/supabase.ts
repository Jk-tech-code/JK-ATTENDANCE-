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

export function isAdmin(user: { user_metadata?: Record<string, unknown> }): boolean {
  return user.user_metadata?.role === "admin"
}

export function getUserRole(user: { user_metadata?: Record<string, unknown> }): string {
  return (user.user_metadata?.role as string) ?? "teacher"
}
