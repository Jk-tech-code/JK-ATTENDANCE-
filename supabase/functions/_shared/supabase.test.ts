import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import '../_shared/denoShim'

type Client = {
  auth: { getUser: (token: string) => Promise<{ data: { user: unknown }; error: unknown }> }
  rpc: (name: string, args?: unknown) => Promise<{ data: unknown; error: unknown }>
  from: (table: string) => unknown
}

// Configure a fresh mock client before each test. We reach into the
// stub's mutable globalThis handle directly rather than going through
// vi.mock, which doesn't survive Vite's alias resolution.
function configureClient(handlers: {
  getUser?: Client['auth']['getUser']
  rpc?: Client['rpc']
  from?: Client['from']
}): Client {
  const client: Client = {
    auth: { getUser: handlers.getUser ?? (async () => ({ data: { user: null }, error: null })) },
    rpc: handlers.rpc ?? (async () => ({ data: null, error: null })),
    from: handlers.from ?? (() => undefined),
  }
  globalThis.__MOCK_SUPABASE__.createClient = () => client
  return client
}

/** Convenience: configure env + a mock client and return the client. */
function setupClient(handlers: Parameters<typeof configureClient>[0] = {}): Client {
  process.env.SUPABASE_URL = 'https://test.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
  return configureClient(handlers)
}

// Import AFTER the global handle exists.
const { createSupabaseAdmin, verifyAuth, isAdmin, isAdminViaRpc } =
  await import('../_shared/supabase')

describe('createSupabaseAdmin', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
  })

  afterEach(() => {
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
  })

  it('returns a client when env vars are set', () => {
    configureClient({})
    expect(() => createSupabaseAdmin()).not.toThrow()
  })

  it('throws when SUPABASE_URL is missing', () => {
    delete process.env.SUPABASE_URL
    configureClient({})
    expect(() => createSupabaseAdmin()).toThrow(/SUPABASE_URL/)
  })

  it('throws when SUPABASE_SERVICE_ROLE_KEY is missing', () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    configureClient({})
    expect(() => createSupabaseAdmin()).toThrow(/SERVICE_ROLE/)
  })
})

describe('verifyAuth', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k'
  })

  afterEach(() => {
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
  })

  it('rejects when Authorization header is missing', async () => {
    configureClient({})
    const res = await verifyAuth(null)
    expect(res.error).toMatch(/Missing or invalid/)
    expect(res.user).toBeNull()
  })

  it('rejects when Authorization header does not start with Bearer ', async () => {
    configureClient({})
    const res = await verifyAuth('Basic xyz')
    expect(res.error).toMatch(/Missing or invalid/)
  })

  it('returns the user when getUser resolves successfully', async () => {
    configureClient({
      getUser: async () => ({ data: { user: { id: 'u-1', email: 'a@b.com' } }, error: null }),
    })
    const res = await verifyAuth('Bearer good-token')
    expect(res.error).toBeNull()
    expect(res.user).toEqual({ id: 'u-1', email: 'a@b.com' })
  })

  it('returns error when getUser fails', async () => {
    configureClient({
      getUser: async () => ({ data: { user: null }, error: { message: 'bad jwt' } }),
    })
    const res = await verifyAuth('Bearer stale-token')
    expect(res.error).toMatch(/Invalid or expired/)
    expect(res.user).toBeNull()
  })
})

describe('isAdmin', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k'
  })

  afterEach(() => {
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
  })

  it('returns true when the teachers query finds a row with role in [admin, superadmin]', async () => {
    let capturedOr: string | null = null
    let capturedIn: [string, string[]] | null = null

    const maybeSingle = () => Promise.resolve({ data: { id: 't-1' }, error: null })
    const inFn = (_col: string, values: string[]) => {
      capturedIn = [_col, values]
      return { maybeSingle }
    }
    const or = (filter: string) => {
      capturedOr = filter
      return { in: inFn }
    }
    const client = setupClient({ from: () => ({ select: () => ({ or }) }) })

    expect(await isAdmin(client, 'u-1')).toBe(true)
    expect(capturedOr).toBe('id.eq.u-1,user_id.eq.u-1,auth_user_id.eq.u-1')
    expect(capturedIn).toEqual(['role', ['admin', 'superadmin']])
  })

  it('returns false when the teachers query finds no row', async () => {
    const maybeSingle = () => Promise.resolve({ data: null, error: null })
    const inFn = () => ({ maybeSingle })
    const or = () => ({ in: inFn })
    const client = setupClient({ from: () => ({ select: () => ({ or }) }) })

    expect(await isAdmin(client, 'u-1')).toBe(false)
  })

  it('falls back to is_admin RPC when the teachers query errors', async () => {
    const maybeSingle = () => Promise.resolve({ data: null, error: { message: 'rls denied' } })
    const inFn = () => ({ maybeSingle })
    const or = () => ({ in: inFn })
    let rpcCalls = 0
    const client = setupClient({
      from: () => ({ select: () => ({ or }) }),
      rpc: async () => {
        rpcCalls += 1
        return { data: true, error: null }
      },
    })

    expect(await isAdmin(client, 'u-1')).toBe(true)
    expect(rpcCalls).toBe(1)
  })

  it('returns false when both the teachers query and RPC fail', async () => {
    const maybeSingle = () => Promise.resolve({ data: null, error: { message: 'rls' } })
    const inFn = () => ({ maybeSingle })
    const or = () => ({ in: inFn })
    const client = setupClient({
      from: () => ({ select: () => ({ or }) }),
      rpc: async () => ({ data: false, error: { message: 'rpc down' } }),
    })

    expect(await isAdmin(client, 'u-1')).toBe(false)
  })
})

describe('isAdminViaRpc', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k'
  })

  afterEach(() => {
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
  })

  it('returns true when is_admin RPC returns true', async () => {
    const client = setupClient({ rpc: async () => ({ data: true, error: null }) })
    expect(await isAdminViaRpc(client)).toBe(true)
  })

  it('returns false on error', async () => {
    const client = setupClient({ rpc: async () => ({ data: null, error: { message: 'oops' } }) })
    expect(await isAdminViaRpc(client)).toBe(false)
  })
})
