import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import '../_shared/denoShim'

type Client = {
  auth: {
    getUser: (token: string) => Promise<{ data: { user: unknown }; error: unknown }>
    admin: {
      createUser: (
        opts: unknown
      ) => Promise<{ data: { user: { id: string } | null }; error: { message: string } | null }>
      deleteUser: (id: string) => Promise<{ error: unknown }>
    }
    resetPasswordForEmail: (email: string, opts?: unknown) => Promise<{ data: unknown; error: unknown }>
  }
  rpc: (name: string, args?: unknown) => Promise<{ data: unknown; error: unknown }>
  from: (table: string) => unknown
}

interface AdminInput {
  email: string
  full_name: string
  role: 'admin' | 'superadmin'
}

/**
 * Build a mock supabase client for create-admin.
 *
 * create-admin's query order:
 *   1) adminMiddleware → verifyAuth (auth.getUser) + query teachers for role
 *   2) GoTrue REST API lookup by email (fetch)
 *   3) from teachers: select('id').eq('email').maybeSingle() — duplicate check
 *   4) from profiles: select('id').eq('email').maybeSingle() — duplicate check
 *   5) inviteUserByEmail
 *   6) from teachers: insert(...)
 *   7) from profiles: update({ role }).eq('id')
 *   8) [on insert error] deleteUser
 */
function configureClient(opts: {
  caller?: { id: string; email?: string }
  getUserError?: { message: string }
  // Role returned by the adminMiddleware query
  callerRole?: 'admin' | 'superadmin' | null
  // GoTrue REST API lookup by email
  existingAuthUser?: { id: string; email: string } | null
  // teachers table duplicate check
  existingTeacher?: { id: string } | null
  // profiles table duplicate check
  existingProfile?: { id: string } | null
  // createUser result
  createdUser?: { id: string } | null
  createUserError?: { message: string }
  // teacher insert result
  insertError?: { message: string }
  // deleteUser call counter (rollback assertion)
  onDeleteUser?: () => void
}): Client {
  const client: Client = {
    auth: {
      getUser: opts.getUserError
        ? async () => ({ data: { user: null }, error: opts.getUserError })
        : async () => ({
            data: {
              user: {
                id: opts.caller?.id ?? 'admin-1',
                email: opts.caller?.email ?? 'admin@school.com',
              },
            },
            error: null,
          }),
      admin: {
        createUser: async () => {
          if (opts.createUserError) return { data: { user: null }, error: opts.createUserError }
          return {
            data: { user: opts.createdUser ? { id: opts.createdUser.id } : null },
            error: null,
          }
        },
        deleteUser: async () => {
          opts.onDeleteUser?.()
          return { error: null }
        },
      },
      resetPasswordForEmail: async () => ({ data: {}, error: null }),
    },
    // H2: the distributed rate limit lives behind the consume_rate_limit
    // RPC (migration 00054). Mocks return an "allowed" row so business
    // tests exercise the operation, not the limiter — rate-limit behavior
    // itself is covered by _shared/rate-limit.test.ts. The limiter is NOT
    // disabled: requests still flow through checkRateLimit.
    rpc: async (name: string) =>
      name === 'consume_rate_limit'
        ? {
            data: [
              {
                allowed: true,
                remaining: 999,
                retry_after: 0,
                reset_at: new Date(Date.now() + 60_000).toISOString(),
              },
            ],
            error: null,
          }
        : { data: null, error: null },
    from: (table: string) => {
      if (table === 'teachers') {
        return {
          select: (cols: string) => {
            if (cols === 'id') {
              // Duplicate check: .eq('email').maybeSingle()
              return {
                eq: () => ({
                  maybeSingle: async () => ({
                    data: opts.existingTeacher ?? null,
                    error: null,
                  }),
                }),
              }
            }
            // Role query from adminMiddleware: .select('role').or(...).in(...).maybeSingle()
            if (cols === 'role') {
              return {
                or: () => ({
                  in: () => ({
                    maybeSingle: async () => ({
                      data: opts.callerRole ? { role: opts.callerRole } : null,
                      error: null,
                    }),
                  }),
                }),
              }
            }
            throw new Error('Unexpected select cols: ' + cols)
          },
          insert: (record: Record<string, unknown>) => {
            if (opts.insertError) {
              return { data: null, error: opts.insertError }
            }
            return {
              data: {
                id: record.id,
                full_name: record.full_name,
                email: record.email,
                role: record.role,
              },
              error: null,
            }
          },
        }
      }
      if (table === 'profiles') {
        return {
          select: (cols: string) => {
            if (cols === 'id') {
              return {
                eq: () => ({
                  maybeSingle: async () => ({
                    data: opts.existingProfile ?? null,
                    error: null,
                  }),
                }),
              }
            }
            throw new Error('Unexpected profiles select: ' + cols)
          },
          update: () => ({
            eq: () => ({
              data: null,
              error: null,
            }),
          }),
        }
      }
      throw new Error('Unexpected from(' + table + ')')
    },
  }

  // Mock fetch for the GoTrue REST API email lookup
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('/auth/v1/admin/users?email=')) {
      if (opts.existingAuthUser) {
        return new Response(JSON.stringify([opts.existingAuthUser]), { status: 200 })
      }
      return new Response(JSON.stringify([]), { status: 200 })
    }
    return originalFetch(input as RequestInfo)
  }

  globalThis.__MOCK_SUPABASE__.createClient = () => client
  return client
}

const { handler } = await import('./index')

function makeRequest(body: AdminInput | unknown, authHeader?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (authHeader) headers.authorization = authHeader
  return new Request('https://example.com/functions/v1/create-admin', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

describe('create-admin', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k'
  })

  afterEach(() => {
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
  })

  describe('admin gating', () => {
    it('rejects unauthenticated callers', async () => {
      configureClient({ getUserError: { message: 'no token' } })
      const res = await handler(
        makeRequest({ email: 'new@school.com', full_name: 'New Admin', role: 'admin' })
      )
      expect(res.status).toBe(401)
    })

    it('rejects authenticated non-admin callers', async () => {
      configureClient({
        caller: { id: 'teacher-1', email: 'teacher@school.com' },
        callerRole: null,
      })
      const res = await handler(
        makeRequest(
          { email: 'new@school.com', full_name: 'New Admin', role: 'admin' },
          'Bearer teacher-1'
        )
      )
      expect(res.status).toBe(403)
    })
  })

  describe('input validation', () => {
    it('returns 400 when email is missing', async () => {
      configureClient({ callerRole: 'superadmin' })
      const res = await handler(
        makeRequest({ full_name: 'New Admin', role: 'admin' }, 'Bearer superadmin')
      )
      expect(res.status).toBe(400)
    })

    it('returns 400 when full_name is missing', async () => {
      configureClient({ callerRole: 'superadmin' })
      const res = await handler(
        makeRequest({ email: 'new@school.com', role: 'admin' }, 'Bearer superadmin')
      )
      expect(res.status).toBe(400)
    })

    it('returns 400 when role is missing', async () => {
      configureClient({ callerRole: 'superadmin' })
      const res = await handler(
        makeRequest({ email: 'new@school.com', full_name: 'New Admin' }, 'Bearer superadmin')
      )
      expect(res.status).toBe(400)
    })

    it('returns 400 for invalid email', async () => {
      configureClient({ callerRole: 'superadmin' })
      const res = await handler(
        makeRequest(
          { email: 'not-an-email', full_name: 'New Admin', role: 'admin' },
          'Bearer superadmin'
        )
      )
      expect(res.status).toBe(400)
    })

    it('returns 400 for invalid role', async () => {
      configureClient({ callerRole: 'superadmin' })
      const res = await handler(
        makeRequest(
          { email: 'new@school.com', full_name: 'New Admin', role: 'teacher' },
          'Bearer superadmin'
        )
      )
      expect(res.status).toBe(400)
    })
  })

  describe('privilege escalation prevention', () => {
    it('admin cannot create superadmin', async () => {
      configureClient({ callerRole: 'admin' })
      const res = await handler(
        makeRequest(
          { email: 'new@school.com', full_name: 'New Superadmin', role: 'superadmin' },
          'Bearer admin'
        )
      )
      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.error).toContain('permission')
    })

    it('superadmin can create admin', async () => {
      configureClient({
        callerRole: 'superadmin',
        existingAuthUser: null,
        existingTeacher: null,
        existingProfile: null,
        createdUser: { id: 'new-1' },
      })
      const res = await handler(
        makeRequest(
          { email: 'new@school.com', full_name: 'New Admin', role: 'admin' },
          'Bearer superadmin'
        )
      )
      expect(res.status).toBe(201)
    })

    it('superadmin can create superadmin', async () => {
      configureClient({
        callerRole: 'superadmin',
        existingAuthUser: null,
        existingTeacher: null,
        existingProfile: null,
        createdUser: { id: 'new-1' },
      })
      const res = await handler(
        makeRequest(
          { email: 'new@school.com', full_name: 'New Superadmin', role: 'superadmin' },
          'Bearer superadmin'
        )
      )
      expect(res.status).toBe(201)
    })

    it('admin can create admin', async () => {
      configureClient({
        callerRole: 'admin',
        existingAuthUser: null,
        existingTeacher: null,
        existingProfile: null,
        createdUser: { id: 'new-1' },
      })
      const res = await handler(
        makeRequest(
          { email: 'new@school.com', full_name: 'New Admin', role: 'admin' },
          'Bearer admin'
        )
      )
      expect(res.status).toBe(201)
    })
  })

  describe('duplicate detection', () => {
    it('returns 409 when auth user with same email exists', async () => {
      configureClient({
        callerRole: 'superadmin',
        existingAuthUser: { id: 'existing-1', email: 'taken@school.com' },
      })
      const res = await handler(
        makeRequest(
          { email: 'taken@school.com', full_name: 'Taken', role: 'admin' },
          'Bearer superadmin'
        )
      )
      expect(res.status).toBe(409)
    })

    it('returns 409 when teacher with same email exists', async () => {
      configureClient({
        callerRole: 'superadmin',
        existingAuthUser: null,
        existingTeacher: { id: 'existing-teacher' },
      })
      const res = await handler(
        makeRequest(
          { email: 'taken@school.com', full_name: 'Taken', role: 'admin' },
          'Bearer superadmin'
        )
      )
      expect(res.status).toBe(409)
    })

    it('returns 409 when profile with same email exists', async () => {
      configureClient({
        callerRole: 'superadmin',
        existingAuthUser: null,
        existingTeacher: null,
        existingProfile: { id: 'existing-profile' },
      })
      const res = await handler(
        makeRequest(
          { email: 'taken@school.com', full_name: 'Taken', role: 'admin' },
          'Bearer superadmin'
        )
      )
      expect(res.status).toBe(409)
    })
  })

  describe('happy path', () => {
    it('creates admin account and returns 201', async () => {
      configureClient({
        callerRole: 'superadmin',
        existingAuthUser: null,
        existingTeacher: null,
        existingProfile: null,
        createdUser: { id: 'new-admin-1' },
      })
      const res = await handler(
        makeRequest(
          { email: 'new@school.com', full_name: 'New Admin', role: 'admin' },
          'Bearer superadmin'
        )
      )
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.admin.email).toBe('new@school.com')
      expect(body.admin.full_name).toBe('New Admin')
      expect(body.admin.role).toBe('admin')
      expect(body.admin.id).toBe('new-admin-1')
      expect(body.admin.temp_password).toBeDefined()
      expect(body.admin.temp_password.length).toBe(16)
    })

    it('creates superadmin account and returns 201', async () => {
      configureClient({
        callerRole: 'superadmin',
        existingAuthUser: null,
        existingTeacher: null,
        existingProfile: null,
        createdUser: { id: 'new-sa-1' },
      })
      const res = await handler(
        makeRequest(
          { email: 'new@school.com', full_name: 'New Superadmin', role: 'superadmin' },
          'Bearer superadmin'
        )
      )
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.admin.role).toBe('superadmin')
    })
  })

  describe('rollback on failure', () => {
    it('deletes auth user when teacher insert fails', async () => {
      let deleteCount = 0
      configureClient({
        callerRole: 'superadmin',
        existingAuthUser: null,
        existingTeacher: null,
        existingProfile: null,
        createdUser: { id: 'new-1' },
        insertError: { message: 'insert failed' },
        onDeleteUser: () => {
          deleteCount += 1
        },
      })
      const res = await handler(
        makeRequest(
          { email: 'new@school.com', full_name: 'New Admin', role: 'admin' },
          'Bearer superadmin'
        )
      )
      expect(res.status).toBe(500)
      expect(deleteCount).toBe(1)
    })
  })

  describe('user creation failures', () => {
    it('returns 400 when createUser fails', async () => {
      configureClient({
        callerRole: 'superadmin',
        existingAuthUser: null,
        existingTeacher: null,
        existingProfile: null,
        createUserError: { message: 'auth error' },
      })
      const res = await handler(
        makeRequest(
          { email: 'new@school.com', full_name: 'New Admin', role: 'admin' },
          'Bearer superadmin'
        )
      )
      expect(res.status).toBe(400)
    })

    it('returns 409 when createUser says user already exists', async () => {
      configureClient({
        callerRole: 'superadmin',
        existingAuthUser: null,
        existingTeacher: null,
        existingProfile: null,
        createUserError: { message: 'User already exists' },
      })
      const res = await handler(
        makeRequest(
          { email: 'new@school.com', full_name: 'New Admin', role: 'admin' },
          'Bearer superadmin'
        )
      )
      expect(res.status).toBe(409)
    })
  })
})
