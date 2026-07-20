export function handleCors(req: Request): Response | null {
  const origin = req.headers.get("origin") ?? ""
  const configuredOrigin = Deno.env.get("CORS_ORIGIN") || ""
  const allowedOrigin = configuredOrigin || origin || "https://jk-attendance.netlify.app"

  const headers = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-region",
    "Access-Control-Max-Age": "86400",
  }

  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 204, headers })
  }

  return null
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? ""
  const configuredOrigin = Deno.env.get("CORS_ORIGIN") || ""
  const allowedOrigin = configuredOrigin || origin || "https://jk-attendance.netlify.app"

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-region",
    "Access-Control-Max-Age": "86400",
    "Content-Type": "application/json",
  }
}

export function jsonResponse(data: unknown, status = 200, req?: Request): Response {
  const headers = req ? corsHeaders(req) : {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": Deno.env.get("CORS_ORIGIN") || "https://jk-attendance.netlify.app",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-region",
    "Access-Control-Max-Age": "86400",
  }

  return new Response(JSON.stringify(data), { status, headers })
}
