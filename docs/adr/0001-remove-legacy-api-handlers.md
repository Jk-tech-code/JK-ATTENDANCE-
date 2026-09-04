# ADR 0001 — Remove `api/*.mjs` Vercel serverless handlers

**Status:** Accepted, 2026-09-04

## Context

The repo shipped two Vercel-style Node serverless handlers under `api/`:
`invite-teacher.mjs` and `delete-teacher.mjs`. Each one:

- read `SUPABASE_SERVICE_ROLE_KEY` from the environment,
- served `Access-Control-Allow-Origin: *`,
- trusted only the Bearer token (no Origin / Referer check),
- in `invite-teacher.mjs`, called `supabase.auth.admin.listUsers()` to check
  for duplicate emails — which is the email-enumeration vector we
  specifically removed when rewriting the equivalent Supabase Edge
  Function (`supabase/functions/invite-teacher/index.ts`).

The frontend never called these endpoints; it talks to the Edge Function
URLs at `${VITE_SUPABASE_URL}/functions/v1/{invite-teacher,delete-teacher}`.
`vercel.json` had no `functions` declaration (so Vercel would only deploy
`api/*.mjs` if they existed, which they did), and `netlify.toml`'s
`functions = "netlify/functions"` pointed at a directory that did not
exist.

## Decision

Delete `api/invite-teacher.mjs` and `api/delete-teacher.mjs`. Drop the
dead `/api/*` redirect from `netlify.toml` and the `functions` line
pointing at the non-existent `netlify/functions/` directory.

The canonical invite/delete paths are now the Edge Functions, which:

- live behind `adminMiddleware` (CORS + JWT + admin role check),
- use `getUserByEmail` instead of `listUsers` for duplicate detection,
- do not expose the service role key to the deployment surface.

## Consequences

- One less attack surface that holds the service-role key behind
  `Access-Control-Allow-Origin: *`.
- No remaining path lets a teacher / unauthenticated caller enumerate
  valid emails via the duplicate check.
- Any future serverless handler must be added as an Edge Function, not
  under `api/`.