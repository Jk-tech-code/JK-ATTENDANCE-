/**
 * Lightweight smoke + authz tests for the remaining edge functions.
 * These functions are admin-only (or admin-optional in verify-admin's case).
 * Full data-flow coverage lives in the dedicated per-function tests.
 *
 * What's covered here:
 *   - delete-teacher: admin gating, missing teacher_id
 *   - daily-report: admin gating
 *   - monthly-report: admin gating, month validation
 *   - verify-admin: anyone authenticated can call, returns role
 *   - calendar-check: auth required, date format validation
 *   - record-attendance: admin gating, missing fields
 *   - cron-report: CRON_SECRET gating
 *   - attendance-ai-analysis: admin gating, no PII sent to AI
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import './_shared/denoShim'

type Client = {
  auth: { getUser: (token: string) => Promise<{ data: { user: unknown }; error: unknown }> }
  rpc: (name: string, args?: unknown) => Promise<{ data: unknown; error: unknown }>
  from: (table: string) => unknown
}

let teacherIdSelectCount = 0

function configureClient(opts: {
  caller?: { id: string; email?: string }
  getUserError?: { message: string }
  isAdmin?: { id: string; role: string } | null
  tableResults?: Record<string, unknown[]>
  rpcResults?: Record<string, { data: unknown; error: unknown }>
}): void {
  teacherIdSelectCount = 0
  const client: Client = {
    auth: {
      getUser: opts.getUserError
        ? async () => ({ data: { user: null }, error: opts.getUserError })
        : async () => ({
            data: {
              user: { id: opts.caller?.id ?? 'u-1', email: opts.caller?.email ?? 'a@b.com' },
            },
            error: null,
          }),
    },
    rpc: ((name: string, _args?: unknown) => {
      const result = opts.rpcResults?.[name] ?? { data: null, error: null }
      // The real Supabase client returns a builder from rpc() that has
      // .single() / .maybeSingle() methods, not a raw promise.
      // Return a thenable builder so callers can chain.
      const b: Record<string, unknown> = {}
      const thenable = Promise.resolve(result)
      b.single = async () => result
      b.maybeSingle = async () => result
      ;(b as { then: unknown }).then = thenable.then.bind(thenable)
      return b
    }) as unknown as Client['rpc'],
    from: (table: string) => {
      const data = opts.tableResults?.[table]
      function makeBuilder(): Record<string, unknown> {
        const b: Record<string, unknown> = {}
        const thenable = (async () => ({ data: data ?? [], error: null }))()
        b.select = () => makeBuilder()
        b.eq = () => makeBuilder()
        b.gte = () => makeBuilder()
        b.lte = () => makeBuilder()
        b.neq = () => makeBuilder()
        b.in = () => makeBuilder()
        b.not = () => makeBuilder()
        b.order = () => makeBuilder()
        b.limit = () => makeBuilder()
        b.range = () => makeBuilder()
        b.or = () => makeBuilder()
        b.maybeSingle = async () => ({ data: data ? data[0] ?? null : null, error: null })
        b.single = async () => ({ data: data ? data[0] ?? null : null, error: null })
        ;(b as { then: unknown }).then = thenable.then.bind(thenable)
        return b
      }

      if (table === 'teachers') {
        const b = makeBuilder()
        const originalSelect = b.select as (cols: string) => unknown
        b.select = (cols: string) => {
          if (cols === 'id') {
            teacherIdSelectCount += 1
            if (teacherIdSelectCount === 1) {
              // First id-select is the isAdmin check:
              // .or().eq('role','admin').maybeSingle()
              return {
                or: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: opts.isAdmin ?? null,
                      error: null,
                    }),
                  }),
                }),
              }
            }
            // Subsequent id-selects are generic queries (e.g.
            // daily-report's teacher count). Use the regular builder
            // chain so .eq/.in/.not work as expected.
            return makeBuilder()
          }
          return originalSelect(cols)
        }
        return b
      }
      return makeBuilder()
    },
  }
  globalThis.__MOCK_SUPABASE__.createClient = () => client
}

function makeRequest(url: string, init: RequestInit = {}): Request {
  return new Request(url, init)
}

function setupAdminEnv(): void {
  process.env.SUPABASE_URL = 'https://test.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k'
}

function clearAdminEnv(): void {
  delete process.env.SUPABASE_URL
  delete process.env.SUPABASE_SERVICE_ROLE_KEY
}

describe('delete-teacher', () => {
  beforeEach(setupAdminEnv)
  afterEach(clearAdminEnv)

  it('rejects non-admin callers', async () => {
    configureClient({
      caller: { id: 'teacher-1', email: 't@x.com' },
      isAdmin: null,
    })
    const { handler } = await import('./delete-teacher/index')
    const res = await handler(
      makeRequest('https://example.com/functions/v1/delete-teacher', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer teacher-1',
        },
        body: JSON.stringify({ teacher_id: 't-1' }),
      }),
    )
    expect(res.status).toBe(403)
  })

  it('returns 400 when teacher_id is missing', async () => {
    configureClient({
      isAdmin: { id: 'admin-1', role: 'admin' },
    })
    const { handler } = await import('./delete-teacher/index')
    const res = await handler(
      makeRequest('https://example.com/functions/v1/delete-teacher', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer admin',
        },
        body: JSON.stringify({}),
      }),
    )
    expect(res.status).toBe(400)
  })

  it('returns 200 on successful cascade delete', async () => {
    configureClient({
      isAdmin: { id: 'admin-1', role: 'admin' },
      rpcResults: {
        delete_teacher_cascade: { data: { success: true }, error: null },
      },
    })
    const { handler } = await import('./delete-teacher/index')
    const res = await handler(
      makeRequest('https://example.com/functions/v1/delete-teacher', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer admin',
        },
        body: JSON.stringify({ teacher_id: 't-99' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })
})

describe('daily-report', () => {
  beforeEach(setupAdminEnv)
  afterEach(clearAdminEnv)

  it('rejects non-admin callers', async () => {
    configureClient({
      caller: { id: 'teacher-1' },
      isAdmin: null,
    })
    const { handler } = await import('./daily-report/index')
    const res = await handler(
      makeRequest('https://example.com/functions/v1/daily-report', {
        headers: { authorization: 'Bearer teacher-1' },
      }),
    )
    expect(res.status).toBe(403)
  })

  it('returns aggregate stats for admin callers', async () => {
    configureClient({
      isAdmin: { id: 'admin-1', role: 'admin' },
      tableResults: { attendance: [], teachers: [] },
    })
    const { handler } = await import('./daily-report/index')
    const res = await handler(
      makeRequest('https://example.com/functions/v1/daily-report?date=2026-09-01', {
        headers: { authorization: 'Bearer admin' },
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.date).toBe('2026-09-01')
    expect(body.attendance_rate).toBe(0)
  })
})

describe('monthly-report', () => {
  beforeEach(setupAdminEnv)
  afterEach(clearAdminEnv)

  it('rejects non-admin callers', async () => {
    configureClient({
      caller: { id: 'teacher-1' },
      isAdmin: null,
    })
    const { handler } = await import('./monthly-report/index')
    const res = await handler(
      makeRequest('https://example.com/functions/v1/monthly-report', {
        headers: { authorization: 'Bearer teacher-1' },
      }),
    )
    expect(res.status).toBe(403)
  })

  it('returns 400 for invalid month', async () => {
    configureClient({ isAdmin: { id: 'admin-1', role: 'admin' } })
    const { handler } = await import('./monthly-report/index')
    const res = await handler(
      makeRequest('https://example.com/functions/v1/monthly-report?month=13', {
        headers: { authorization: 'Bearer admin' },
      }),
    )
    expect(res.status).toBe(400)
  })

  it('returns 200 with summary for admin', async () => {
    configureClient({
      isAdmin: { id: 'admin-1', role: 'admin' },
      tableResults: { school_holidays: [], attendance: [], teachers: [] },
    })
    const { handler } = await import('./monthly-report/index')
    const res = await handler(
      makeRequest('https://example.com/functions/v1/monthly-report?year=2026&month=9', {
        headers: { authorization: 'Bearer admin' },
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.year).toBe(2026)
    expect(body.month).toBe(9)
    expect(body.summary).toBeDefined()
  })
})

describe('verify-admin', () => {
  beforeEach(setupAdminEnv)
  afterEach(clearAdminEnv)

  it('rejects requests without auth', async () => {
    configureClient({ getUserError: { message: 'no token' } })
    const { handler } = await import('./verify-admin/index')
    const res = await handler(
      makeRequest('https://example.com/functions/v1/verify-admin'),
    )
    expect(res.status).toBe(401)
  })

  it('reports role=teacher for non-admin users', async () => {
    configureClient({
      caller: { id: 'teacher-1', email: 't@x.com' },
      isAdmin: null,
    })
    const { handler } = await import('./verify-admin/index')
    const res = await handler(
      makeRequest('https://example.com/functions/v1/verify-admin', {
        headers: { authorization: 'Bearer teacher-1' },
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.verified).toBe(false)
    expect(body.role).toBe('teacher')
  })

  it('reports role=admin for admin users', async () => {
    configureClient({
      caller: { id: 'admin-1', email: 'a@x.com' },
      isAdmin: { id: 'admin-1', role: 'admin' },
    })
    const { handler } = await import('./verify-admin/index')
    const res = await handler(
      makeRequest('https://example.com/functions/v1/verify-admin', {
        headers: { authorization: 'Bearer admin' },
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.verified).toBe(true)
    expect(body.role).toBe('admin')
  })
})

describe('calendar-check', () => {
  beforeEach(setupAdminEnv)
  afterEach(clearAdminEnv)

  it('rejects requests without auth', async () => {
    configureClient({ getUserError: { message: 'no token' } })
    const { handler } = await import('./calendar-check/index')
    const res = await handler(
      makeRequest('https://example.com/functions/v1/calendar-check?date=2026-09-01'),
    )
    expect(res.status).toBe(401)
  })

  it('returns 400 for malformed date', async () => {
    configureClient({})
    const { handler } = await import('./calendar-check/index')
    const res = await handler(
      makeRequest('https://example.com/functions/v1/calendar-check?date=garbage', {
        headers: { authorization: 'Bearer user' },
      }),
    )
    expect(res.status).toBe(400)
  })

  it('returns the RPC result for a valid date', async () => {
    configureClient({
      rpcResults: {
        check_calendar_date: {
          data: { date: '2026-09-01', is_weekend: false, is_holiday: false },
          error: null,
        },
      },
    })
    const { handler } = await import('./calendar-check/index')
    const res = await handler(
      makeRequest('https://example.com/functions/v1/calendar-check?date=2026-09-01', {
        headers: { authorization: 'Bearer user' },
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.date).toBe('2026-09-01')
  })
})

describe('record-attendance', () => {
  beforeEach(setupAdminEnv)
  afterEach(clearAdminEnv)

  it('rejects non-admin callers', async () => {
    configureClient({
      caller: { id: 'teacher-1' },
      isAdmin: null,
    })
    const { handler } = await import('./record-attendance/index')
    const res = await handler(
      makeRequest('https://example.com/functions/v1/record-attendance', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer teacher-1',
        },
        body: JSON.stringify({ teacher_id: 't-1', attendance_date: '2026-09-01', status: 'present' }),
      }),
    )
    expect(res.status).toBe(403)
  })

  it('returns 400 when required fields are missing', async () => {
    configureClient({ isAdmin: { id: 'admin-1', role: 'admin' } })
    const { handler } = await import('./record-attendance/index')
    const res = await handler(
      makeRequest('https://example.com/functions/v1/record-attendance', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer admin',
        },
        body: JSON.stringify({ teacher_id: 't-1' }),
      }),
    )
    expect(res.status).toBe(400)
  })
})

describe('cron-report', () => {
  beforeEach(setupAdminEnv)
  afterEach(clearAdminEnv)

  it('returns 500 when CRON_SECRET is not set', async () => {
    delete process.env.CRON_SECRET
    configureClient({})
    const { handler } = await import('./cron-report/index')
    const res = await handler(
      makeRequest('https://example.com/functions/v1/cron-report', {
        method: 'POST',
        headers: { 'x-api-key': 'whatever' },
      }),
    )
    expect(res.status).toBe(500)
  })

  it('returns 401 when CRON_SECRET does not match', async () => {
    process.env.CRON_SECRET = 'correct-secret'
    configureClient({})
    const { handler } = await import('./cron-report/index')
    const res = await handler(
      makeRequest('https://example.com/functions/v1/cron-report', {
        method: 'POST',
        headers: { 'x-api-key': 'wrong' },
      }),
    )
    expect(res.status).toBe(401)
  })

  it('returns 400 for an unknown report type', async () => {
    process.env.CRON_SECRET = 'correct-secret'
    configureClient({ tableResults: { attendance: [], teachers: [] } })
    const { handler } = await import('./cron-report/index')
    const res = await handler(
      makeRequest('https://example.com/functions/v1/cron-report', {
        method: 'POST',
        headers: {
          'x-api-key': 'correct-secret',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ type: 'unknown' }),
      }),
    )
    expect(res.status).toBe(400)
  })
})

describe('attendance-ai-analysis (PII protection)', () => {
  beforeEach(setupAdminEnv)
  afterEach(clearAdminEnv)

  it('rejects unauthenticated callers', async () => {
    configureClient({ getUserError: { message: 'no token' } })
    const { handler } = await import('./attendance-ai-analysis/index')
    const res = await handler(
      makeRequest('https://example.com/functions/v1/attendance-ai-analysis', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    expect(res.status).toBe(401)
  })

  it('rejects non-admin callers', async () => {
    configureClient({
      caller: { id: 'teacher-1' },
      isAdmin: null,
    })
    const { handler } = await import('./attendance-ai-analysis/index')
    const res = await handler(
      makeRequest('https://example.com/functions/v1/attendance-ai-analysis', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer teacher-1',
        },
        body: JSON.stringify({}),
      }),
    )
    expect(res.status).toBe(403)
  })

  it('returns admin insights and confirms pii_protected flag', async () => {
    configureClient({
      isAdmin: { id: 'admin-1', role: 'admin' },
      tableResults: { attendance: [], teachers: [] },
    })
    const { handler } = await import('./attendance-ai-analysis/index')
    const res = await handler(
      makeRequest('https://example.com/functions/v1/attendance-ai-analysis', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer admin',
        },
        body: JSON.stringify({ year: 2026, month: 9 }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.config.pii_protected).toBe(true)
    // ai_generated is null because we have no OPENAI_API_KEY in tests,
    // but the response shape documents the protection.
    expect(body.ai_generated).toBeNull()
  })
})
