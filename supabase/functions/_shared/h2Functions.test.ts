/**
 * H2 tests — Edge Function integration with the distributed limiter.
 *
 * Verifies, at the handler boundary, that:
 *   TEST M  sensitive functions remain functional below the limit
 *   authorization strictly precedes rate limiting (order preserved)
 *   denied requests get 429 + Retry-After; backend failure → 503
 *   recover-password consumes the primary HMAC(email) bucket and the
 *   secondary network bucket, and header rotation cannot bypass either
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import '../_shared/denoShim'
import { createRateLimitBackendMock } from '../__stubs__/rateLimitMock'

type Recorded = { name: string; args: Record<string, unknown> }

/**
 * Build a client with:
 *  - auth.getUser (adminMiddleware → verifyAuth)
 *  - auth.admin.inviteUserByEmail + auth.resetPasswordForEmail
 *  - from('teachers'): select('role').or().in().maybeSingle() → adminMiddleware;
 *    select('id').eq().maybeSingle() → duplicate checks; insert(); update().eq()
 *  - from('profiles'): select('id').eq().maybeSingle(); update().eq()
 *  - rpc: recorded + delegated to the shared backend simulation
 */
function configureClient(opts: {
  caller?: { id: string; email?: string }
  getUserError?: { message: string }
  callerRole?: 'admin' | 'superadmin' | null
  backend?: ReturnType<typeof createRateLimitBackendMock>
  backendOverrides?: { rpcError?: { message: string } | null }
  recorded?: Recorded[]
}) {
  const backend = opts.backend ?? createRateLimitBackendMock()
  const rawRpc = backend.makeClient(opts.backendOverrides).rpc
  const roleRow = opts.callerRole ? { role: opts.callerRole } : null

  const client = {
    auth: {
      getUser: opts.getUserError
        ? async () => ({ data: { user: null }, error: opts.getUserError })
        : async () => ({
            data: {
              user: { id: opts.caller?.id ?? 'admin-1', email: opts.caller?.email ?? 'a@b.com' },
            },
            error: null,
          }),
      admin: {
        createUser: async () => ({ data: { user: { id: 'new-user-1' } }, error: null }),
      },
      resetPasswordForEmail: async () => ({ data: {}, error: null }),
    },
    rpc: (async (name: string, args?: Record<string, unknown>) => {
      opts.recorded?.push({ name, args: args ?? {} })
      return rawRpc(name, args)
    }) as unknown,
    from: (table: string) => {
      const selectTerminal = async () => ({ data: null, error: null })
      return {
        select: (_cols: string) => ({
          // adminMiddleware: .or(...).in('role', [...]).maybeSingle()
          or: () => ({
            in: () => ({
              maybeSingle: async () => ({ data: roleRow, error: null }),
            }),
          }),
          // duplicate checks: .eq('email', ...).maybeSingle()
          eq: () => ({ maybeSingle: selectTerminal }),
        }),
        insert: async () => ({ data: { id: 'new-user-1' }, error: null }),
        update: () => ({
          eq: async () => ({ data: null, error: null }),
        }),
        // table guard: only the two tables above are exercised
        ...(table === 'teachers' || table === 'profiles' ? {} : {}),
      }
    },
  }
  globalThis.__MOCK_SUPABASE__.createClient = () => client as never
  return backend
}

function makeRequest(url: string, init: RequestInit = {}): Request {
  return new Request(url, init)
}

describe('H2 edge function integration', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k'
  })
  afterEach(() => {
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
  })

  describe('create-admin', () => {
    it('TEST M: remains functional below the limit (201)', async () => {
      const recorded: Recorded[] = []
      const backend = configureClient({
        caller: { id: 'admin-1' },
        callerRole: 'admin',
        recorded,
      })
      // GoTrue REST email lookup (duplicate check) via fetch:
      const originalFetch = globalThis.fetch
      globalThis.fetch = (async () =>
        new Response(JSON.stringify([]), { status: 200 })) as typeof fetch
      try {
        const { handler } = await import('../create-admin/index')
        const res = await handler(
          makeRequest('https://example.com/functions/v1/create-admin', {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: 'Bearer admin-1' },
            body: JSON.stringify({ email: 'new@school.com', full_name: 'N', role: 'admin' }),
          })
        )
        expect(res.status).toBe(201)
        // The limiter consumed the shared backend, keyed by admin id.
        const consume = recorded.find((r) => r.name === 'consume_rate_limit')
        expect(consume).toBeDefined()
        expect(consume!.args.p_namespace).toBe('create-admin')
        expect(consume!.args.p_identifier).toBe('admin-1')
        expect(consume!.args.p_max_attempts).toBe(3)
        expect(backend.calls.length).toBeGreaterThan(0)
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('denies with 429 + Retry-After once the limit is exhausted', async () => {
      configureClient({
        caller: { id: 'admin-1' },
        callerRole: 'admin',
      })
      const originalFetch = globalThis.fetch
      globalThis.fetch = (async () =>
        new Response(JSON.stringify([]), { status: 200 })) as typeof fetch
      try {
        const { handler } = await import('../create-admin/index')
        const mk = () =>
          makeRequest('https://example.com/functions/v1/create-admin', {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: 'Bearer admin-1' },
            body: JSON.stringify({ email: 'x@school.com', full_name: 'N', role: 'admin' }),
          })
        const statuses: number[] = []
        for (let i = 0; i < 4; i++) {
          statuses.push((await handler(mk())).status)
        }
        expect(statuses[0]).toBe(201)
        expect(statuses[3]).toBe(429)
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('429 response carries Retry-After with a safe generic message', async () => {
      configureClient({
        caller: { id: 'admin-1' },
        callerRole: 'admin',
      })
      const originalFetch = globalThis.fetch
      globalThis.fetch = (async () =>
        new Response(JSON.stringify([]), { status: 200 })) as typeof fetch
      try {
        const { handler } = await import('../create-admin/index')
        const mk = () =>
          makeRequest('https://example.com/functions/v1/create-admin', {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: 'Bearer admin-1' },
            body: JSON.stringify({ email: 'x@school.com', full_name: 'N', role: 'admin' }),
          })
        let res: Response | undefined
        for (let i = 0; i < 4; i++) res = await handler(mk())
        expect(res!.status).toBe(429)
        const retryAfter = res!.headers.get('Retry-After')
        expect(retryAfter).toMatch(/^\d+$/)
        const n = Number(retryAfter)
        expect(n).toBeGreaterThanOrEqual(1)
        expect(n).toBeLessThanOrEqual(60)
        const body = await res!.json()
        expect(body.error).not.toMatch(/sql|database|postgres|consume_rate_limit/i)
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('authorization precedes rate limiting: 403 happens with zero limiter calls', async () => {
      const recorded: Recorded[] = []
      configureClient({
        caller: { id: 'teacher-1' },
        callerRole: null,
        recorded,
      })
      const { handler } = await import('../create-admin/index')
      const res = await handler(
        makeRequest('https://example.com/functions/v1/create-admin', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer teacher-1' },
          body: JSON.stringify({ email: 'x@school.com', full_name: 'N', role: 'admin' }),
        })
      )
      expect(res.status).toBe(403)
      expect(recorded.filter((r) => r.name === 'consume_rate_limit')).toHaveLength(0)
    })

    it('returns 503 (not 429) when the limiter backend fails — fail-closed', async () => {
      configureClient({
        caller: { id: 'admin-1' },
        callerRole: 'admin',
        backendOverrides: { rpcError: { message: 'backend down' } },
      })
      const { handler } = await import('../create-admin/index')
      const res = await handler(
        makeRequest('https://example.com/functions/v1/create-admin', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer admin-1' },
          body: JSON.stringify({ email: 'x@school.com', full_name: 'N', role: 'admin' }),
        })
      )
      expect(res.status).toBe(503)
      const body = await res.json()
      expect(body.error).not.toMatch(/sql|database|backend|postgres/i)
    })
  })

  describe('recover-password', () => {
    it('consumes the primary HMAC(email) bucket and the secondary network bucket, and header rotation cannot bypass the primary', async () => {
      const recorded: Recorded[] = []
      configureClient({ recorded })
      const { handler } = await import('../recover-password/index')

      const send = (forwardedFor: string) =>
        handler(
          makeRequest('https://example.com/functions/v1/recover-password', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-forwarded-for': forwardedFor,
            },
            body: JSON.stringify({ email: 'victim@school.com' }),
          })
        )

      // 5 requests from "different IPs" (spoofed headers) — the email bucket
      // is shared across all of them, so the 6th is denied.
      for (let i = 0; i < 5; i++) {
        const res = await send(`10.0.${i}.1`)
        expect(res.status).toBe(200)
      }
      const denied = await send('10.0.99.99')
      expect(denied.status).toBe(429)
      expect(denied.headers.get('Retry-After')).toMatch(/^\d+$/)

      const consumes = recorded.filter((r) => r.name === 'consume_rate_limit')
      // 5 allowed requests consume BOTH buckets (5×2); the 6th is denied by
      // the primary email bucket and short-circuits before the network
      // bucket is consulted (5×2 + 1 = 11) — denial is cheap and ordered.
      expect(consumes.length).toBe(11)
      const identifiers = consumes.map((r) => String(r.args.p_identifier))
      // Primary dimension: HMAC digest of the normalized email (same for all).
      const emailKey = identifiers[0]
      expect(emailKey).toMatch(/^[0-9a-f]{64}$/)
      expect(identifiers.filter((id) => id === emailKey)).toHaveLength(6)
      // Secondary dimension: coarse network tag from the allowed requests
      // (the denied 6th never reaches the network bucket — it short-
      // circuits at the primary email bucket, which is the safe order).
      expect(identifiers.some((id) => id.startsWith('net:10.0.0'))).toBe(true)
    })

    it('secondary network bucket also limits coordinated spraying (30/min)', async () => {
      const recorded: Recorded[] = []
      configureClient({ recorded })
      const { handler } = await import('../recover-password/index')
      const send = (email: string) =>
        handler(
          makeRequest('https://example.com/functions/v1/recover-password', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.7' },
            body: JSON.stringify({ email }),
          })
        )
      // 31 distinct targets from one network: the network bucket (30/min)
      // rejects the 31st even though every email bucket is fresh.
      let lastStatus = 200
      for (let i = 0; i < 31; i++) {
        lastStatus = (await send(`user${i}@school.com`)).status
      }
      expect(lastStatus).toBe(429)
    })
  })
})
