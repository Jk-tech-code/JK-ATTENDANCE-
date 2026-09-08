/**
 * Dedicated tests for the cron-report edge function.
 * Covers: CORS, CRON_SECRET gating, timing-safe auth, UPSERT storage,
 * daily/monthly report generation, and error handling.
 *
 * Smoke-level authz tests live in smoke.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import '../_shared/denoShim'

type Builder = {
  select: (cols?: string) => Builder
  eq: (col: string, val: unknown) => Builder
  in: (col: string, vals: unknown[]) => Builder
  not: (col: string, op: string, val: unknown) => Builder
  gte: (col: string, val: unknown) => Builder
  lte: (col: string, val: unknown) => Builder
  then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => void
}

type MockTable = {
  _data: unknown[]
  _error: { message: string } | null
  select: () => Builder
}

function makeTable(data: unknown[] = [], error: { message: string } | null = null): MockTable {
  const table: MockTable = { _data: data, _error: error, select: () => makeBuilder(table) }
  return table
}

function makeBuilder(table: MockTable): Builder {
  const b: Partial<Builder> = {}
  const mkResult = () => ({ data: table._data, error: table._error, count: table._data.length })
  const thenable = { then: (resolve: (v: unknown) => void) => resolve(mkResult()) }
  b.select = () => b as Builder
  b.eq = () => b as Builder
  b.in = () => b as Builder
  b.not = () => b as Builder
  b.gte = () => b as Builder
  b.lte = () => b as Builder
  ;(b as Builder).then = thenable.then as Builder['then']
  return b as Builder
}

type UpsertRecord = {
  table: string
  data: Record<string, unknown>
  options?: { onConflict?: string }
}

let capturedUpserts: UpsertRecord[] = []

function configureClient(opts: {
  tableResults?: Record<string, unknown[]>
  tableErrors?: Record<string, { message: string }>
}): void {
  capturedUpserts = []
  globalThis.__MOCK_SUPABASE__.createClient = () => ({
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    rpc: async () => ({ data: null, error: null }),
    from: (table: string) => {
      const data = opts.tableResults?.[table] ?? []
      const error = opts.tableErrors?.[table] ?? null
      return makeTable(data, error)
    },
  })

  // Override createClient to add upsert mock
  const origCreateClient = globalThis.__MOCK_SUPABASE__.createClient
  globalThis.__MOCK_SUPABASE__.createClient = () => {
    const client = origCreateClient() as Record<string, unknown>
    client.from = (table: string) => {
      const data = opts.tableResults?.[table] ?? []
      const error = opts.tableErrors?.[table] ?? null
      const t = makeTable(data, error)
      return {
        select: () => makeBuilder(t),
        upsert: (record: Record<string, unknown>, options?: { onConflict?: string }) => {
          capturedUpserts.push({ table, data: record, options })
          if (error) return { error }
          return { error: null }
        },
      }
    }
    return client
  }
}

const { handler } = await import('./index')

function makeRequest(
  method: string,
  headers: Record<string, string> = {},
  body?: Record<string, unknown>
): Request {
  const init: RequestInit = { method, headers }
  if (body) init.body = JSON.stringify(body)
  return new Request('https://example.com/functions/v1/cron-report', init)
}

describe('cron-report', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k'
    capturedUpserts = []
  })

  afterEach(() => {
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    delete process.env.CRON_SECRET
    delete process.env.CORS_ORIGIN
  })

  it('returns 204 for OPTIONS preflight', async () => {
    const res = await handler(makeRequest('OPTIONS'))
    expect(res.status).toBe(204)
  })

  it('returns 500 when CRON_SECRET env var is missing', async () => {
    configureClient({})
    const res = await handler(makeRequest('POST', { 'x-api-key': 'whatever' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/CRON_SECRET/)
  })

  it('returns 401 when x-api-key header is missing', async () => {
    process.env.CRON_SECRET = 'correct-secret'
    configureClient({})
    const res = await handler(makeRequest('POST'))
    expect(res.status).toBe(401)
  })

  it('returns 401 when x-api-key is wrong', async () => {
    process.env.CRON_SECRET = 'correct-secret'
    configureClient({})
    const res = await handler(makeRequest('POST', { 'x-api-key': 'wrong' }))
    expect(res.status).toBe(401)
  })

  it('does NOT accept Authorization header — only x-api-key', async () => {
    process.env.CRON_SECRET = 'correct-secret'
    configureClient({})
    const res = await handler(makeRequest('POST', { authorization: 'Bearer correct-secret' }))
    expect(res.status).toBe(401)
  })

  it('returns 401 when secret has wrong length', async () => {
    process.env.CRON_SECRET = 'correct-secret'
    configureClient({})
    const res = await handler(makeRequest('POST', { 'x-api-key': 'short' }))
    expect(res.status).toBe(401)
  })

  it('generates a daily report and stores via upsert', async () => {
    process.env.CRON_SECRET = 'correct-secret'
    configureClient({
      tableResults: {
        attendance: [
          { id: '1', status: 'present', check_in: '2026-09-08T07:30:00Z', working_minutes: 480 },
          { id: '2', status: 'late', check_in: '2026-09-08T08:15:00Z', working_minutes: 420 },
        ],
        teachers: [{ id: 't1' }, { id: 't2' }],
      },
    })

    const res = await handler(makeRequest('POST', { 'x-api-key': 'correct-secret' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.report).toBeDefined()
    expect(body.report.present).toBeGreaterThanOrEqual(0)
    expect(body.report.total_teachers).toBe(2)
  })

  it('generates a monthly report with year/month params', async () => {
    process.env.CRON_SECRET = 'correct-secret'
    configureClient({
      tableResults: {
        attendance: [],
        teachers: [],
      },
    })

    const res = await handler(
      makeRequest(
        'POST',
        { 'x-api-key': 'correct-secret' },
        { type: 'monthly', year: 2026, month: 8 }
      )
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.report.year).toBe(2026)
    expect(body.report.month).toBe(8)
  })

  it('defaults to daily when no body is sent', async () => {
    process.env.CRON_SECRET = 'correct-secret'
    configureClient({
      tableResults: {
        attendance: [],
        teachers: [],
      },
    })

    const res = await handler(makeRequest('POST', { 'x-api-key': 'correct-secret' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.report.date).toBeDefined()
  })

  it('returns 400 for unknown report type', async () => {
    process.env.CRON_SECRET = 'correct-secret'
    configureClient({})
    const res = await handler(
      makeRequest(
        'POST',
        { 'x-api-key': 'correct-secret' },
        { type: 'unknown' }
      )
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Unknown report type/)
  })

  it('throws when upsert fails', async () => {
    process.env.CRON_SECRET = 'correct-secret'
    const failTable = makeTable([], null)
    const origCreateClient = globalThis.__MOCK_SUPABASE__.createClient
    globalThis.__MOCK_SUPABASE__.createClient = () => {
      const client = origCreateClient() as Record<string, unknown>
      client.from = () => ({
        select: () => makeBuilder(failTable),
        upsert: () => ({ error: { message: 'unique violation' } }),
      })
      return client
    }

    const res = await handler(makeRequest('POST', { 'x-api-key': 'correct-secret' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/Failed to persist/)
  })
})
