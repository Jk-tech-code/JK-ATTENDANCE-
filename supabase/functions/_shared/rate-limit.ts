/**
 * H2 — Distributed rate limiting for Edge Functions (PostgreSQL-backed).
 *
 * Replaces the former module-scoped in-memory Map, which was NOT reliable in
 * production: every Edge Function isolate kept its own counter, cold starts
 * reset counters, concurrent isolates bypassed limits, and horizontal
 * scaling created independent counters.
 *
 * Architecture: L2 distributed authoritative protection.
 *   A single atomic RPC (public.consume_rate_limit, migration 00054)
 *   creates-or-increments a fixed-window bucket row under row lock, so the
 *   authoritative counter is shared by every isolate and can never exceed
 *   the configured limit under concurrency.
 *
 * Failure policy (documented, see Step 11): FAIL CLOSED. If the distributed
 * backend cannot determine whether the request is within the limit, the
 * request is rejected with 503 (not 429 — it is not a rate-limit result and
 * must not leak infrastructure detail; the message is generic). Reason:
 * every consumer of this module protects a sensitive operation (account
 * lifecycle, credential recovery). Callers pass `failOpen: true` to opt out
 * for less sensitive endpoints; nothing in this project does.
 *
 * This module is stateless — there is intentionally NO local in-memory
 * counter here, so tests cannot pass merely because of shared module state,
 * and there is no "duplicate local limiter" to drift out of sync.
 */

export interface RateLimitResult {
  allowed: boolean
  /** Tokens left in the current window after this consume (0 when denied). */
  remaining: number
  /** Seconds until the window resets (0 when allowed). */
  retryAfter: number
  /** Absolute window reset time, ISO 8601 (null when the backend failed). */
  resetAt: string | null
}

export interface RateLimitCheck {
  /** Isolated namespace, e.g. the endpoint name ('invite-teacher'). */
  namespace: string
  /** Server-trusted identity (admin user id, hashed email, etc). */
  identifier: string
  /** Max requests allowed in the window. */
  maxAttempts: number
  /** Window length in seconds. */
  windowSeconds: number
  /**
   * When true, a backend failure allows the request instead of rejecting it.
   * Default: false (fail closed). Sensitive endpoints must NOT set this.
   */
  failOpen?: boolean
}

/** Minimal shape of the supabase client this module needs (test-friendly). */
export type RateLimitRpcClient = {
  rpc: (
    name: string,
    args?: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message?: string } | null }>
}

interface ConsumeRow {
  allowed: boolean
  remaining: number | string
  retry_after: number | string
  reset_at: string
}

function toInt(v: number | string | undefined | null): number {
  const n = typeof v === 'string' ? parseInt(v, 10) : (v ?? NaN)
  return Number.isFinite(n) ? n : NaN
}

/**
 * Retention (Step 13): expired bucket rows are purged by the database's
 * cleanup_rate_limit_buckets() (migration 00054, also cron-able). The shared
 * layer fires that cleanup opportunistically on ~2% of consumes so the table
 * stays bounded without paying a cleanup query on every request.
 * Housekeeping only: this carries NO rate-limit state and never affects
 * allow/deny outcomes; failures are swallowed.
 */
const CLEANUP_PROBABILITY = 0.02

function maybeCleanupExpiredBuckets(client: RateLimitRpcClient): void {
  if (Math.random() >= CLEANUP_PROBABILITY) return
  void client
    .rpc('cleanup_rate_limit_buckets')
    .then(() => undefined)
    .catch(() => undefined)
}

function normalizeRow(data: unknown): ConsumeRow | null {
  if (Array.isArray(data)) data = data[0]
  if (!data || typeof data !== 'object') return null
  const row = data as Record<string, unknown>
  if (typeof row.allowed !== 'boolean') return null
  return {
    allowed: row.allowed,
    remaining: toInt(row.remaining as number | string),
    retry_after: toInt(row.retry_after as number | string),
    reset_at: typeof row.reset_at === 'string' ? row.reset_at : '',
  }
}

/**
 * Rate-limit key design helpers (H2, Step 7).
 *
 * x-forwarded-for is NOT trusted as a security identity on this deployment:
 * it can be client-supplied depending on the request path, so a caller could
 * rotate it to obtain fresh buckets. These helpers build keys from:
 *  - server-trusted identities (admin user id from verified JWT), or
 *  - HMAC-SHA256 digests of normalized account identifiers (peppered with a
 *    server-only secret), optionally combined with a COARSE best-effort
 *    IP tag that is never the sole security boundary.
 */

/**
 * HMAC-SHA256 hex digest of a value, keyed by RATE_LIMIT_PEPPER (falling
 * back to the service-role key — both server-only). Prevents storing or
 * logging raw identifiers and prevents attackers from constructing keys.
 */
export async function hmacIdentifier(value: string): Promise<string> {
  const pepper =
    Deno.env.get('RATE_LIMIT_PEPPER') ??
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
    'jk-attendance-rate-limit'
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Coarse, privacy-preserving best-effort source tag from forwarding headers.
 * Deliberately NOT identity-grade: IPv4 truncated to /24, IPv6 to /48, and
 * 'unknown' when absent. Use only as a secondary dimension, never alone.
 */
export function coarseIpTag(forwardedFor: string | null): string {
  const first = forwardedFor?.split(',')[0]?.trim() ?? ''
  if (!first) return 'unknown'
  if (first.includes(':')) {
    return first.split(':').slice(0, 3).join(':')
  }
  const parts = first.split('.')
  if (parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p))) {
    return parts.slice(0, 3).join('.')
  }
  return first.slice(0, 32)
}

/**
 * Consume one token from the distributed fixed-window bucket.
 *
 * One RPC round trip; no local state. Returns a RateLimitResult, or null
 * when the backend failed (caller decides fail-open vs fail-closed).
 */
export async function consumeRateLimit(
  client: RateLimitRpcClient,
  check: RateLimitCheck
): Promise<{ ok: true; result: RateLimitResult } | { ok: false; error: string }> {
  try {
    const { data, error } = await client.rpc('consume_rate_limit', {
      p_namespace: check.namespace,
      p_identifier: check.identifier,
      p_max_attempts: check.maxAttempts,
      p_window_seconds: check.windowSeconds,
    })

    if (error) return { ok: false, error: error.message ?? 'rate limit backend error' }

    const row = normalizeRow(data)
    if (!row) return { ok: false, error: 'rate limit backend returned malformed result' }

    const remaining = toInt(row.remaining)
    const retryAfter = toInt(row.retry_after)
    if (!Number.isFinite(remaining) || !Number.isFinite(retryAfter)) {
      return { ok: false, error: 'rate limit backend returned malformed result' }
    }

    maybeCleanupExpiredBuckets(client)

    return {
      ok: true,
      result: {
        allowed: row.allowed,
        remaining,
        retryAfter: Math.max(retryAfter, 0),
        resetAt: row.reset_at || null,
      },
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'rate limit backend failure',
    }
  }
}

/**
 * Check a rate limit and return the HTTP-facing outcome, applying the
 * fail-open/fail-closed policy for backend failures.
 *
 * - allowed        → proceed with the operation
 * - denied         → respond 429 + Retry-After (never leaks internals)
 * - backend failed → fail-closed (default): respond 503 with a generic
 *                    message; fail-open: proceed.
 *
 * Never logs identifiers or other sensitive data.
 */
export async function enforceRateLimit(
  client: RateLimitRpcClient,
  check: RateLimitCheck
): Promise<
  | { allowed: true; remaining: number; resetAt: string | null }
  | { allowed: false; status: 429 | 503; retryAfter: number; message: string }
> {
  const res = await consumeRateLimit(client, check)

  if (res.ok) {
    if (res.result.allowed) {
      return { allowed: true, remaining: res.result.remaining, resetAt: res.result.resetAt }
    }
    return {
      allowed: false,
      status: 429,
      retryAfter: Math.max(res.result.retryAfter, 1),
      message: 'Too many requests. Please try again later.',
    }
  }

  // ── Backend failure path ─────────────────────────────────────────────
  // Log only the failure class, never the identifier/namespace payload.
  console.error('[rate-limit] backend failure:', res.error)
  if (check.failOpen) {
    return { allowed: true, remaining: -1, resetAt: null }
  }
  return {
    allowed: false,
    status: 503,
    retryAfter: 0,
    message: 'Service temporarily unavailable. Please try again later.',
  }
}

/**
 * Convenience helper preserving the previous call signature shape
 * (namespace, identifier, max, window) on top of enforceRateLimit.
 */
export function checkRateLimit(
  client: RateLimitRpcClient,
  namespace: string,
  identifier: string,
  maxAttempts: number,
  windowSeconds: number,
  opts?: { failOpen?: boolean }
): Promise<
  | { allowed: true; remaining: number; resetAt: string | null }
  | { allowed: false; status: 429 | 503; retryAfter: number; message: string }
> {
  return enforceRateLimit(client, {
    namespace,
    identifier,
    maxAttempts,
    windowSeconds,
    failOpen: opts?.failOpen,
  })
}
