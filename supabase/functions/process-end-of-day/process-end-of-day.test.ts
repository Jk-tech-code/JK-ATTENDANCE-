import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import '../_shared/denoShim'

type RpcResult = { data: unknown; error: { message: string } | null }

function configureRpc(impl: (name: string, args?: unknown) => Promise<RpcResult>): void {
  globalThis.__MOCK_SUPABASE__.createClient = () => ({
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    rpc: impl as never,
    from: () => undefined,
  })
}

const { handler } = await import('./index')

function makeRequest(
  method: string,
  headers: Record<string, string> = {},
): Request {
  return new Request('https://example.com/functions/v1/process-end-of-day', {
    method,
    headers,
  })
}

describe('process-end-of-day', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k'
  })

  afterEach(() => {
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    delete process.env.CRON_SECRET
    delete process.env.CORS_ORIGIN
  })

  it('returns 204 for an OPTIONS preflight', async () => {
    const res = await handler(makeRequest('OPTIONS'))
    expect(res.status).toBe(204)
  })

  it('returns 500 when CRON_SECRET env var is missing (do not silently run)', async () => {
    const res = await handler(makeRequest('POST', { 'x-api-key': 'whatever' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/CRON_SECRET/)
  })

  it('returns 401 when x-api-key header is missing', async () => {
    process.env.CRON_SECRET = 'correct-secret'
    const res = await handler(makeRequest('POST'))
    expect(res.status).toBe(401)
  })

  it('returns 401 when x-api-key is wrong', async () => {
    process.env.CRON_SECRET = 'correct-secret'
    const res = await handler(makeRequest('POST', { 'x-api-key': 'wrong' }))
    expect(res.status).toBe(401)
  })

  it('does NOT accept Authorization header — only x-api-key', async () => {
    process.env.CRON_SECRET = 'correct-secret'
    const res = await handler(
      makeRequest('POST', { authorization: 'Bearer correct-secret' }),
    )
    expect(res.status).toBe(401)
  })

  it('returns 401 when the secret is the wrong length', async () => {
    process.env.CRON_SECRET = 'correct-secret'
    const res = await handler(makeRequest('POST', { 'x-api-key': 'short' }))
    expect(res.status).toBe(401)
  })

  it('runs the process_end_of_day RPC and returns 200 on success', async () => {
    process.env.CRON_SECRET = 'correct-secret'
    let rpcCalled = 0
    configureRpc(async (name) => {
      rpcCalled += 1
      expect(name).toBe('process_end_of_day')
      return { data: null, error: null }
    })

    const res = await handler(makeRequest('POST', { 'x-api-key': 'correct-secret' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ success: true })
    expect(rpcCalled).toBe(1)
  })

  it('returns 500 when the RPC errors', async () => {
    process.env.CRON_SECRET = 'correct-secret'
    configureRpc(async () => ({
      data: null,
      error: { message: 'permission denied for table teachers' },
    }))

    const res = await handler(makeRequest('POST', { 'x-api-key': 'correct-secret' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.success).toBeUndefined()
    expect(body.error).toBeDefined()
  })
})