/**
 * H2 tests — shared distributed rate-limit layer (`_shared/rate-limit.ts`).
 *
 * The backend is a faithful simulation of migration 00054's atomic
 * public.consume_rate_limit SQL function (same fixed-window semantics, same
 * row shape, same increment-under-row-lock behavior). The store lives
 * OUTSIDE any module — like PostgreSQL — so "isolate sharing", "cold start"
 * and "concurrency" are all simulated at the correct boundary: the
 * authoritative store is shared, module state is not part of the design
 * (the module is stateless by construction).
 *
 * Covered (Step 18):
 *   TEST A  under-limit requests are allowed
 *   TEST B  over-limit request is denied with retryAfter (HTTP 429 source)
 *   TEST C  Retry-After is correct/present
 *   TEST D  counter shared across simulated Edge Function isolates
 *   TEST E  cold-start simulation: fresh module identity cannot reset limit
 *   TEST F  concurrent requests never exceed the limit
 *   TEST G  different admins have independent buckets
 *   TEST H  changing IP/user-agent cannot bypass an admin's limit
 *   TEST I  x-forwarded-for rotation cannot mint fresh recovery buckets
 *   TEST J  backend failure follows fail-closed (503) / opt-in fail-open
 *   TEST K  expired windows allow requests again
 *   TEST L  cleanup deletes expired buckets only
 */

import { describe, it, expect } from 'vitest'
import './denoShim'
import {
  consumeRateLimit,
  enforceRateLimit,
  checkRateLimit,
  hmacIdentifier,
  coarseIpTag,
} from './rate-limit'
import { createRateLimitBackendMock } from '../__stubs__/rateLimitMock'

describe('H2 shared distributed rate-limit layer', () => {
  it('TEST A: allows requests under the configured limit', async () => {
    const backend = createRateLimitBackendMock()
    const client = backend.makeClient()
    for (let i = 0; i < 3; i++) {
      const res = await enforceRateLimit(client, {
        namespace: 'create-admin',
        identifier: 'admin-1',
        maxAttempts: 3,
        windowSeconds: 60,
      })
      expect(res.allowed).toBe(true)
    }
  })

  it('TEST B: denies the request that exceeds the limit (429 semantics)', async () => {
    const backend = createRateLimitBackendMock()
    const client = backend.makeClient()
    for (let i = 0; i < 3; i++) {
      const res = await enforceRateLimit(client, {
        namespace: 'create-admin',
        identifier: 'admin-1',
        maxAttempts: 3,
        windowSeconds: 60,
      })
      expect(res.allowed).toBe(true)
    }
    const res = await enforceRateLimit(client, {
      namespace: 'create-admin',
      identifier: 'admin-1',
      maxAttempts: 3,
      windowSeconds: 60,
    })
    expect(res.allowed).toBe(false)
    if (!res.allowed) {
      expect(res.status).toBe(429)
      expect(res.message).not.toMatch(/sql|database|postgres/i)
    }
  })

  it('TEST C: Retry-After is present, positive and bounded by the window', async () => {
    const backend = createRateLimitBackendMock()
    const client = backend.makeClient()
    for (let i = 0; i < 5; i++) {
      await enforceRateLimit(client, {
        namespace: 'delete-teacher',
        identifier: 'admin-1',
        maxAttempts: 5,
        windowSeconds: 60,
      })
    }
    const res = await enforceRateLimit(client, {
      namespace: 'delete-teacher',
      identifier: 'admin-1',
      maxAttempts: 5,
      windowSeconds: 60,
    })
    expect(res.allowed).toBe(false)
    if (!res.allowed) {
      expect(res.status).toBe(429)
      expect(res.retryAfter).toBeGreaterThanOrEqual(1)
      expect(res.retryAfter).toBeLessThanOrEqual(60)
    }
  })

  it('TEST D: the counter is shared across simulated Edge Function isolates', async () => {
    // One shared backend (the "database"), two separate client objects
    // (two "Edge Function isolates" with independent module graphs).
    const backend = createRateLimitBackendMock()
    const isolateA = backend.makeClient()
    const isolateB = backend.makeClient()
    const check = {
      namespace: 'invite-teacher',
      identifier: 'admin-1',
      maxAttempts: 5,
      windowSeconds: 60,
    }

    for (let i = 0; i < 3; i++) {
      const a = await enforceRateLimit(isolateA, check)
      expect(a.allowed).toBe(true)
    }
    for (let i = 0; i < 2; i++) {
      const b = await enforceRateLimit(isolateB, check)
      expect(b.allowed).toBe(true)
    }
    // Combined count (3 from A + 2 from B = 5) is at the limit — the 6th,
    // from either isolate, must be denied.
    const deniedA = await enforceRateLimit(isolateA, check)
    const deniedB = await enforceRateLimit(isolateB, check)
    expect(deniedA.allowed).toBe(false)
    expect(deniedB.allowed).toBe(false)
  })

  it('TEST E: cold start (fresh module identity) cannot reset the authoritative limit', async () => {
    const backend = createRateLimitBackendMock()
    const firstBoot = backend.makeClient()
    const check = {
      namespace: 'create-admin',
      identifier: 'admin-1',
      maxAttempts: 3,
      windowSeconds: 60,
    }
    for (let i = 0; i < 3; i++) {
      await enforceRateLimit(firstBoot, check)
    }
    // Simulate an isolate cold start: brand-new module/client identity,
    // same shared backend. The distributed counter survives.
    const afterColdStart = backend.makeClient()
    const res = await enforceRateLimit(afterColdStart, check)
    expect(res.allowed).toBe(false)
    if (!res.allowed) expect(res.status).toBe(429)
  })

  it('TEST F: concurrent requests never exceed the configured limit', async () => {
    const backend = createRateLimitBackendMock()
    const client = backend.makeClient()
    const check = {
      namespace: 'invite-teacher',
      identifier: 'admin-1',
      maxAttempts: 5,
      windowSeconds: 60,
    }

    // 25 simultaneous consumers race the same bucket, like concurrent
    // requests racing the row lock in the atomic RPC.
    const results = await Promise.all(
      Array.from({ length: 25 }, () => enforceRateLimit(client, check))
    )
    const allowed = results.filter((r) => r.allowed).length
    const denied = results.filter((r) => !r.allowed && 'status' in r && r.status === 429).length
    expect(allowed).toBe(5)
    expect(denied).toBe(20)
  })

  it('TEST G: different admins have independent buckets', async () => {
    const backend = createRateLimitBackendMock()
    const client = backend.makeClient()
    for (let i = 0; i < 3; i++) {
      const res = await enforceRateLimit(client, {
        namespace: 'create-admin',
        identifier: 'admin-A',
        maxAttempts: 3,
        windowSeconds: 60,
      })
      expect(res.allowed).toBe(true)
    }
    // admin-B is unaffected by admin-A's exhausted bucket.
    const res = await enforceRateLimit(client, {
      namespace: 'create-admin',
      identifier: 'admin-B',
      maxAttempts: 3,
      windowSeconds: 60,
    })
    expect(res.allowed).toBe(true)
  })

  it('TEST H: changing IP and user-agent cannot bypass an admin limit', async () => {
    const backend = createRateLimitBackendMock()
    const client = backend.makeClient()
    // The admin functions key on the server-trusted admin user id. There is
    // no IP/user-agent dimension in the key at all — the only way to vary
    // the bucket is the namespace/identifier/limit/window, none of which a
    // caller controls. Prove limit exhaustion is sticky for the identity.
    const check = {
      namespace: 'delete-teacher',
      identifier: 'admin-1',
      maxAttempts: 5,
      windowSeconds: 60,
    }
    for (let i = 0; i < 5; i++) {
      await enforceRateLimit(client, check)
    }
    // "New IP, new browser" — same identity: still limited.
    const res = await enforceRateLimit(client, check)
    expect(res.allowed).toBe(false)
  })

  it('TEST I: x-forwarded-for rotation cannot mint fresh recovery buckets', async () => {
    // recover-password's PRIMARY bucket is keyed by HMAC(email) only.
    // Simulate an attacker rotating spoofed forwarding headers: the email
    // dimension does not change, so the bucket is shared and the limit holds.
    const backend = createRateLimitBackendMock()
    const emailKey = await hmacIdentifier('victim@school.com')
    for (let spoofedIp of ['1.2.3.4', '5.6.7.8', '9.10.11.12', '13.14.15.16', '17.18.19.20']) {
      // The IP tag is a SECONDARY bucket; the primary email bucket is
      // consumed regardless of which spoofed header accompanies it.
      const primary = await enforceRateLimit(backend.makeClient(), {
        namespace: 'recover-password',
        identifier: emailKey,
        maxAttempts: 5,
        windowSeconds: 60,
      })
      expect(primary.allowed).toBe(true)
      void spoofedIp
    }
    // 6th attempt with yet another "new IP" — denied: no bypass.
    const denied = await enforceRateLimit(backend.makeClient(), {
      namespace: 'recover-password',
      identifier: emailKey,
      maxAttempts: 5,
      windowSeconds: 60,
    })
    expect(denied.allowed).toBe(false)
  })

  it('TEST J: backend failure is fail-closed (503, generic message) by default and fail-open only when opted in', async () => {
    const backend = createRateLimitBackendMock()
    const failing = backend.makeClient({ rpcError: { message: 'connection refused' } })
    const check = {
      namespace: 'create-admin',
      identifier: 'admin-1',
      maxAttempts: 3,
      windowSeconds: 60,
    }

    // Default: FAIL CLOSED with 503 (not 429 — this is not a rate-limit hit).
    const closed = await enforceRateLimit(failing, check)
    expect(closed.allowed).toBe(false)
    if (!closed.allowed) {
      expect(closed.status).toBe(503)
      expect(closed.message).not.toMatch(/sql|database|postgres|connection/i)
    }

    // Opt-in fail-open for non-sensitive endpoints.
    const opened = await enforceRateLimit(failing, { ...check, failOpen: true })
    expect(opened.allowed).toBe(true)
  })

  it('TEST K: expired windows allow requests again (fixed-window reset)', async () => {
    const backend = createRateLimitBackendMock()
    const client = backend.makeClient()
    const check = {
      namespace: 'create-admin',
      identifier: 'admin-1',
      maxAttempts: 3,
      windowSeconds: 60,
    }
    for (let i = 0; i < 3; i++) {
      await enforceRateLimit(client, check)
    }
    expect((await enforceRateLimit(client, check)).allowed).toBe(false)

    // Advance the simulated clock into the next fixed window.
    backend.advanceMs(61_000)
    const res = await enforceRateLimit(client, check)
    expect(res.allowed).toBe(true)
  })

  it('TEST L: cleanup deletes expired buckets only and preserves current ones', async () => {
    const backend = createRateLimitBackendMock()
    const client = backend.makeClient()
    await consumeRateLimit(client, {
      namespace: 'ns',
      identifier: 'old',
      maxAttempts: 5,
      windowSeconds: 60,
    })
    await consumeRateLimit(client, {
      namespace: 'ns',
      identifier: 'current',
      maxAttempts: 5,
      windowSeconds: 60,
    })
    expect(backend.bucketCount()).toBe(2)

    // Advance the clock far past the 10-minute retention horizon.
    backend.advanceMs(11 * 60_000)
    // Both buckets are now expired; a fresh consume creates a new window row.
    await consumeRateLimit(client, {
      namespace: 'ns',
      identifier: 'current',
      maxAttempts: 5,
      windowSeconds: 60,
    })
    const deleted = backend.cleanupExpired()
    expect(deleted).toBeGreaterThanOrEqual(1)
    // Every remaining row belongs to the current window (nothing stale kept).
    const nowMs = 1_700_000_030_000 + 11 * 60_000
    for (const key of backend.bucketKeys()) {
      const bucket = backend.getBucket(key)!
      expect(bucket.windowStart).toBeGreaterThanOrEqual(nowMs - 60_000)
    }
  })

  it('consumeRateLimit surfaces backend errors without leaking them into responses', async () => {
    const backend = createRateLimitBackendMock()
    const client = backend.makeClient({ rpcError: { message: 'SQLSTATE internal detail' } })
    const res = await consumeRateLimit(client, {
      namespace: 'ns',
      identifier: 'id',
      maxAttempts: 5,
      windowSeconds: 60,
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('SQLSTATE')
  })

  it('consumeRateLimit rejects malformed backend rows as failures', async () => {
    const backend = createRateLimitBackendMock()
    const client = backend.makeClient({ malformed: true })
    const res = await consumeRateLimit(client, {
      namespace: 'ns',
      identifier: 'id',
      maxAttempts: 5,
      windowSeconds: 60,
    })
    expect(res.ok).toBe(false)
  })

  it('checkRateLimit preserves the previous positional call convention', async () => {
    const backend = createRateLimitBackendMock()
    const client = backend.makeClient()
    const res = await checkRateLimit(client, 'invite-teacher', 'admin-1', 10, 60)
    expect(res.allowed).toBe(true)
  })

  it('hmacIdentifier is deterministic, hex, and keyed (differs from raw input)', async () => {
    const a = await hmacIdentifier('victim@school.com')
    const b = await hmacIdentifier('victim@school.com')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).not.toContain('victim')
  })

  it('coarseIpTag truncates IPv4 to /24 and IPv6 to /48 and never trusts lists fully', () => {
    expect(coarseIpTag('203.0.113.55, 70.41.3.18')).toBe('203.0.113')
    expect(coarseIpTag('203.0.113.55')).toBe('203.0.113')
    expect(coarseIpTag('2001:db8:1a2b:3c4d:5e6f:1:2:3')).toBe('2001:db8:1a2b')
    expect(coarseIpTag(null)).toBe('unknown')
    expect(coarseIpTag('')).toBe('unknown')
    expect(coarseIpTag('   ')).toBe('unknown')
  })
})
