export function handleCors(req: Request): Response | null {
  const origin = req.headers.get("origin") ?? ""
  const configuredOrigin = Deno.env.get("CORS_ORIGIN") || ""

  const allowedOrigin = configuredOrigin || "https://jkattendance.vercel.app"

  const headers = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-region",
    "Access-Control-Max-Age": "86400",
  }

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers })
  }

  if (configuredOrigin && origin && origin !== configuredOrigin) {
    return new Response(JSON.stringify({ error: "Origin not allowed" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    })
  }

  return null
}

export function corsHeaders(): Record<string, string> {
  const configuredOrigin = Deno.env.get("CORS_ORIGIN") || ""
  const allowedOrigin = configuredOrigin || "https://jkattendance.vercel.app"

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-region",
    "Access-Control-Max-Age": "86400",
    "Content-Type": "application/json",
  }
}

export function jsonResponse(data: unknown, status = 200): Response {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": (Deno.env.get("CORS_ORIGIN") || "https://jkattendance.vercel.app"),
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-region",
    "Access-Control-Max-Age": "86400",
  }

  return new Response(JSON.stringify(data), { status, headers })
}
