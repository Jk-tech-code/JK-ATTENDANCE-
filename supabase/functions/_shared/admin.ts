import { createSupabaseAdmin, verifyAuth, isAdmin } from "./supabase.ts"
import { handleCors, jsonResponse } from "./cors.ts"

export interface AdminVerificationResult {
  isAdmin: boolean
  userId: string
  email: string
  error?: string
}

/**
 * Verifies that the request is from an authenticated admin user.
 * Returns the verification result or throws a Response if unauthorized.
 *
 * Usage in edge functions:
 * ```typescript
 * const { isAdmin, userId, email, error } = await verifyAdminRequest(req.headers.get("Authorization"))
 * if (error) return error // Already a Response object
 * ```
 */
export async function verifyAdminRequest(
  authHeader: string | null
): Promise<AdminVerificationResult | Response> {
  const auth = await verifyAuth(authHeader)
  if (auth.error) {
    return jsonResponse({ error: auth.error }, 401)
  }

  const supabase = createSupabaseAdmin()
  const admin = await isAdmin(supabase, auth.user!.id)

  if (!admin) {
    return jsonResponse({ error: "Forbidden: Admin access required" }, 403)
  }

  return {
    isAdmin: true,
    userId: auth.user!.id,
    email: auth.user!.email ?? "",
  }
}

/**
 * Middleware wrapper for admin-only edge functions.
 * Handles CORS, auth verification, and method checking.
 *
 * Usage:
 * ```typescript
 * Deno.serve(async (req: Request) => {
 *   const adminResult = await adminMiddleware(req, "POST")
 *   if (adminResult instanceof Response) return adminResult
 *   const { userId, email } = adminResult
 *   // ... handle request
 * })
 * ```
 */
export async function adminMiddleware(
  req: Request,
  allowedMethod: string = "POST"
): Promise<AdminVerificationResult | Response> {
  const cors = handleCors(req)
  if (cors) return cors

  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": Deno.env.get("CORS_ORIGIN") ?? "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    })
  }

  if (req.method !== allowedMethod) {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  return verifyAdminRequest(req.headers.get("Authorization"))
}