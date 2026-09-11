import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import '../_shared/denoShim'

type Client = {
  auth: {
    getUser: (token: string) => Promise<{ data: { user: unknown }; error: unknown }>
    admin: {
      createUser: (
        opts: unknown
      ) => Promise<{ data: { user: { id: string } | null }; error: { message: string } | null }>
      updateUserById: (
        id: string,
        opts: unknown
      ) => Promise<{ error: { message: string } | null }>
      deleteUser: (id: string) => Promise<{ error: unknown }>
    }
  }
  rpc: (name: string, args?: unknown) => Promise<{ data: unknown; error: unknown }>
  from: (table: string) => unknown
}

interface TeacherRow {
  id: string
  role?: string
  full_name?: string
}

interface InviteInput {
  staff_number: string
  full_name: string
  email: string
  department?: string
  phone?: string
  reporting_time?: string
  resend_email?: string
}

function configureClient(opts: {
  caller?: { id: string; email?: string }
  getUserError?: { message: string }
  isAdmin?: TeacherRow | null
  existingAuthUser?: { id: string; email: string } | null
  existingTeacher?: TeacherRow | null
  createdUser?: { id: string } | null
  createUserError?: { message: string }
  updateUserError?: { message: string }
  insertedTeacher?: TeacherRow | { id: string; full_name: string; email: string } | null
  insertError?: { message: string }
  onDeleteUser?: () => void
  updateError?: { message: string }
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
        updateUserById: async () => {
          if (opts.updateUserError) return { error: opts.updateUserError }
          return { error: null }
        },
        deleteUser: async () => {
          opts.onDeleteUser?.()
          return { error: null }
        },
      },
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
      if (table !== 'teachers') {
        throw new Error(`Unexpected from(${table})`)
      }
      const builder = {
        select: (cols: string) => {
          if (cols === 'id') {
            return {
              or: () => ({
                maybeSingle: async () => ({
                  data: opts.existingTeacher ?? null,
                  error: null,
                }),
              }),
              eq: () => ({
                maybeSingle: async () => ({
                  data: opts.existingTeacher ?? null,
                  error: null,
                }),
              }),
            }
          }
          if (cols === 'id, full_name') {
            return {
              eq: () => ({
                maybeSingle: async () => ({
                  data: opts.existingTeacher ?? null,
                  error: null,
                }),
              }),
            }
          }
          if (cols === 'role') {
            return {
              or: () => ({
                in: () => ({
                  maybeSingle: async () => ({
                    data: opts.isAdmin ? { role: opts.isAdmin.role ?? 'admin' } : null,
                    error: null,
                  }),
                }),
              }),
            }
          }
          throw new Error('Unexpected select cols: ' + cols)
        },
        insert: (record: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              if (opts.insertError) {
                return { data: null, error: opts.insertError }
              }
              return {
                data:
                  opts.insertedTeacher ??
                  ({
                    id: record.id as string,
                    full_name: record.full_name as string,
                    email: record.email as string,
                  } as never),
                error: null,
              }
            },
          }),
        }),
        update: (updateData: Record<string, unknown>) => ({
          eq: () => ({
            select: () => ({
              maybeSingle: async () => {
                if (opts.updateError) return { data: null, error: opts.updateError }
                return { data: { ...updateData, id: 'teacher-1' }, error: null }
              },
              single: async () => {
                if (opts.updateError) return { data: null, error: opts.updateError }
                return { data: { ...updateData, id: 'teacher-1' }, error: null }
              },
            }),
          }),
        }),
      }
      return builder
    },
  }

  // Mock fetch for GoTrue REST API lookup
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('/auth/v1/admin/users?email=')) {
      if (opts.existingAuthUser) {
        return new Response(JSON.stringify([opts.existingAuthUser]), { status: 200 })
      }
      return new Response(JSON.stringify([]), { status: 200 })
    }
    return originalFetch(input as RequestInfo, init)
  }

  globalThis.__MOCK_SUPABASE__.createClient = () => client
  return client
}

const { handler } = await import('./index')

function makeRequest(body: InviteInput | unknown, authHeader?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (authHeader) headers.authorization = authHeader
  return new Request('https://example.com/functions/v1/invite-teacher', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

describe('invite-teacher', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k'
    process.env.SITE_URL = 'https://jk-attendance.vercel.app'
  })

  afterEach(() => {
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    delete process.env.SITE_URL
  })

  describe('admin gating', () => {
    it('rejects unauthenticated callers', async () => {
      configureClient({ getUserError: { message: 'no token' } })
      const res = await handler(
        makeRequest({ staff_number: 'S-1', full_name: 'T', email: 't@x.com' })
      )
      expect(res.status).toBe(401)
    })

    it('rejects authenticated non-admin callers', async () => {
      configureClient({
        caller: { id: 'teacher-1', email: 'teacher@school.com' },
        isAdmin: null,
      })
      const res = await handler(
        makeRequest({ staff_number: 'S-1', full_name: 'T', email: 't@x.com' }, 'Bearer teacher-1')
      )
      expect(res.status).toBe(403)
    })

    it('rejects non-POST methods', async () => {
      configureClient({})
      const res = await handler(
        new Request('https://example.com/functions/v1/invite-teacher', {
          method: 'GET',
          headers: { authorization: 'Bearer admin' },
        })
      )
      expect([204, 405]).toContain(res.status)
    })
  })

  describe('input validation', () => {
    it('returns 400 when staff_number is missing', async () => {
      configureClient({ isAdmin: { id: 'admin-1', role: 'admin' } })
      const res = await handler(makeRequest({ full_name: 'T', email: 't@x.com' }, 'Bearer admin'))
      expect(res.status).toBe(400)
    })

    it('returns 400 when full_name is missing', async () => {
      configureClient({ isAdmin: { id: 'admin-1', role: 'admin' } })
      const res = await handler(
        makeRequest({ staff_number: 'S-1', email: 't@x.com' }, 'Bearer admin')
      )
      expect(res.status).toBe(400)
    })

    it('returns 400 when email is missing', async () => {
      configureClient({ isAdmin: { id: 'admin-1', role: 'admin' } })
      const res = await handler(
        makeRequest({ staff_number: 'S-1', full_name: 'T' }, 'Bearer admin')
      )
      expect(res.status).toBe(400)
    })

    it('returns 400 for invalid reporting_time: 25:00', async () => {
      configureClient({
        isAdmin: { id: 'admin-1', role: 'admin' },
        existingAuthUser: null,
        existingTeacher: null,
        createdUser: { id: 'new-auth-1' },
      })
      const res = await handler(
        makeRequest(
          { staff_number: 'S-1', full_name: 'T', email: 't@x.com', reporting_time: '25:00' },
          'Bearer admin'
        )
      )
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/reporting_time/)
    })

    it('returns 400 for invalid reporting_time: 12:60', async () => {
      configureClient({
        isAdmin: { id: 'admin-1', role: 'admin' },
        existingAuthUser: null,
        existingTeacher: null,
        createdUser: { id: 'new-auth-1' },
      })
      const res = await handler(
        makeRequest(
          { staff_number: 'S-1', full_name: 'T', email: 't@x.com', reporting_time: '12:60' },
          'Bearer admin'
        )
      )
      expect(res.status).toBe(400)
    })

    it('returns 400 for invalid reporting_time: 7:00 (no leading zero)', async () => {
      configureClient({
        isAdmin: { id: 'admin-1', role: 'admin' },
        existingAuthUser: null,
        existingTeacher: null,
        createdUser: { id: 'new-auth-1' },
      })
      const res = await handler(
        makeRequest(
          { staff_number: 'S-1', full_name: 'T', email: 't@x.com', reporting_time: '7:00' },
          'Bearer admin'
        )
      )
      expect(res.status).toBe(400)
    })

    it('returns 400 for invalid reporting_time: abc', async () => {
      configureClient({
        isAdmin: { id: 'admin-1', role: 'admin' },
        existingAuthUser: null,
        existingTeacher: null,
        createdUser: { id: 'new-auth-1' },
      })
      const res = await handler(
        makeRequest(
          { staff_number: 'S-1', full_name: 'T', email: 't@x.com', reporting_time: 'abc' },
          'Bearer admin'
        )
      )
      expect(res.status).toBe(400)
    })

    it('returns 400 for invalid reporting_time: 24:00', async () => {
      configureClient({
        isAdmin: { id: 'admin-1', role: 'admin' },
        existingAuthUser: null,
        existingTeacher: null,
        createdUser: { id: 'new-auth-1' },
      })
      const res = await handler(
        makeRequest(
          { staff_number: 'S-1', full_name: 'T', email: 't@x.com', reporting_time: '24:00' },
          'Bearer admin'
        )
      )
      expect(res.status).toBe(400)
    })

    it('accepts valid reporting_time: 07:20', async () => {
      configureClient({
        isAdmin: { id: 'admin-1', role: 'admin' },
        existingAuthUser: null,
        existingTeacher: null,
        createdUser: { id: 'new-auth-1' },
        insertedTeacher: { id: 'new-auth-1', full_name: 'T', email: 't@x.com' },
      })
      const res = await handler(
        makeRequest(
          { staff_number: 'S-1', full_name: 'T', email: 't@x.com', reporting_time: '07:20' },
          'Bearer admin'
        )
      )
      expect(res.status).toBe(201)
    })

    it('accepts valid reporting_time: 00:00', async () => {
      configureClient({
        isAdmin: { id: 'admin-1', role: 'admin' },
        existingAuthUser: null,
        existingTeacher: null,
        createdUser: { id: 'new-auth-1' },
        insertedTeacher: { id: 'new-auth-1', full_name: 'T', email: 't@x.com' },
      })
      const res = await handler(
        makeRequest(
          { staff_number: 'S-1', full_name: 'T', email: 't@x.com', reporting_time: '00:00' },
          'Bearer admin'
        )
      )
      expect(res.status).toBe(201)
    })

    it('accepts valid reporting_time: 23:59', async () => {
      configureClient({
        isAdmin: { id: 'admin-1', role: 'admin' },
        existingAuthUser: null,
        existingTeacher: null,
        createdUser: { id: 'new-auth-1' },
        insertedTeacher: { id: 'new-auth-1', full_name: 'T', email: 't@x.com' },
      })
      const res = await handler(
        makeRequest(
          { staff_number: 'S-1', full_name: 'T', email: 't@x.com', reporting_time: '23:59' },
          'Bearer admin'
        )
      )
      expect(res.status).toBe(201)
    })

    it('accepts null reporting_time (optional field)', async () => {
      configureClient({
        isAdmin: { id: 'admin-1', role: 'admin' },
        existingAuthUser: null,
        existingTeacher: null,
        createdUser: { id: 'new-auth-1' },
        insertedTeacher: { id: 'new-auth-1', full_name: 'T', email: 't@x.com' },
      })
      const res = await handler(
        makeRequest(
          { staff_number: 'S-1', full_name: 'T', email: 't@x.com' },
          'Bearer admin'
        )
      )
      expect(res.status).toBe(201)
    })
  })

  describe('duplicate detection', () => {
    it('returns 409 when an auth user with the same email already exists', async () => {
      configureClient({
        isAdmin: { id: 'admin-1', role: 'admin' },
        existingAuthUser: { id: 'auth-1', email: 't@x.com' },
      })
      const res = await handler(
        makeRequest({ staff_number: 'S-1', full_name: 'T', email: 't@x.com' }, 'Bearer admin')
      )
      expect(res.status).toBe(409)
    })

    it('continues when no auth user with the same email exists', async () => {
      configureClient({
        isAdmin: { id: 'admin-1', role: 'admin' },
        existingAuthUser: null,
        existingTeacher: null,
        createdUser: { id: 'new-auth-1' },
        insertedTeacher: { id: 'new-auth-1', full_name: 'T', email: 't@x.com' },
      })
      const res = await handler(
        makeRequest({ staff_number: 'S-1', full_name: 'T', email: 't@x.com' }, 'Bearer admin')
      )
      expect(res.status).toBe(201)
    })

    it('returns 409 when a teacher record with the same email or staff_number exists', async () => {
      configureClient({
        isAdmin: { id: 'admin-1', role: 'admin' },
        existingAuthUser: null,
        existingTeacher: { id: 'teacher-existing' },
      })
      const res = await handler(
        makeRequest({ staff_number: 'S-1', full_name: 'T', email: 't@x.com' }, 'Bearer admin')
      )
      expect(res.status).toBe(409)
    })
  })

  describe('happy path', () => {
    it('creates user with temp password and teacher record', async () => {
      let insertedRecord: Record<string, unknown> | null = null
      configureClient({
        isAdmin: { id: 'admin-1', role: 'admin' },
        existingAuthUser: null,
        existingTeacher: null,
        createdUser: { id: 'new-auth-1' },
        insertedTeacher: null,
      })

      const original = globalThis.__MOCK_SUPABASE__.createClient
      globalThis.__MOCK_SUPABASE__.createClient = () => {
        const c = original() as Client
        const originalFrom = c.from
        c.from = ((table: string) => {
          if (table === 'teachers') {
            const builder = originalFrom(table) as ReturnType<typeof originalFrom>
            return {
              ...builder,
              insert: (record: Record<string, unknown>) => {
                insertedRecord = record
                return (
                  builder as unknown as { insert: (r: Record<string, unknown>) => unknown }
                ).insert(record)
              },
            }
          }
          return originalFrom(table)
        }) as Client['from']
        return c
      }

      const res = await handler(
        makeRequest(
          {
            staff_number: 'S-1',
            full_name: 'Jane Doe',
            email: 'jane@school.com',
            department: 'Math',
            phone: '+1234567890',
            reporting_time: '07:30',
          },
          'Bearer admin'
        )
      )
      if (res.status !== 201) {
        const body = await res.json()
        throw new Error(`expected 201, got ${res.status}: ${JSON.stringify(body)}`)
      }
      const body = await res.json()
      expect(body.teacher.id).toBe('new-auth-1')
      expect(body.temp_password).toBeDefined()
      expect(typeof body.temp_password).toBe('string')
      expect(body.temp_password.length).toBeGreaterThanOrEqual(8)
      expect(insertedRecord).toMatchObject({
        id: 'new-auth-1',
        user_id: 'new-auth-1',
        auth_user_id: 'new-auth-1',
        staff_number: 'S-1',
        full_name: 'Jane Doe',
        email: 'jane@school.com',
        department: 'Math',
        phone: '+1234567890',
        reporting_time: '07:30',
        role: 'teacher',
        invitation_sent: true,
      })
      expect(insertedRecord?.invited_at).toBeDefined()
    })
  })

  describe('rollback on teacher insert failure', () => {
    it('calls auth.admin.deleteUser when teacher insert fails', async () => {
      let deleteCount = 0
      configureClient({
        isAdmin: { id: 'admin-1', role: 'admin' },
        existingAuthUser: null,
        existingTeacher: null,
        createdUser: { id: 'new-auth-1' },
        insertError: { message: 'teachers_insert_failed' },
        onDeleteUser: () => {
          deleteCount += 1
        },
      })

      const res = await handler(
        makeRequest({ staff_number: 'S-1', full_name: 'T', email: 't@x.com' }, 'Bearer admin')
      )
      expect(res.status).toBe(400)
      expect(deleteCount).toBe(1)
    })
  })

  describe('createUser failures', () => {
    it('returns 400 when createUser fails', async () => {
      configureClient({
        isAdmin: { id: 'admin-1', role: 'admin' },
        existingAuthUser: null,
        existingTeacher: null,
        createUserError: { message: 'create user failed' },
      })
      const res = await handler(
        makeRequest({ staff_number: 'S-1', full_name: 'T', email: 't@x.com' }, 'Bearer admin')
      )
      expect(res.status).toBe(400)
    })

    it('returns 409 when createUser fails with duplicate error', async () => {
      configureClient({
        isAdmin: { id: 'admin-1', role: 'admin' },
        existingAuthUser: null,
        existingTeacher: null,
        createUserError: { message: 'User already exists' },
      })
      const res = await handler(
        makeRequest({ staff_number: 'S-1', full_name: 'T', email: 't@x.com' }, 'Bearer admin')
      )
      expect(res.status).toBe(409)
    })
  })

  describe('resend (reset password)', () => {
    it('returns 404 when no auth user found for resend', async () => {
      configureClient({
        isAdmin: { id: 'admin-1', role: 'admin' },
        existingAuthUser: null,
      })
      const res = await handler(
        makeRequest(
          { staff_number: 'S-1', full_name: 'T', email: 't@x.com', resend_email: 't@x.com' },
          'Bearer admin'
        )
      )
      expect(res.status).toBe(404)
    })

    it('returns 404 when no teacher record found for resend', async () => {
      configureClient({
        isAdmin: { id: 'admin-1', role: 'admin' },
        existingAuthUser: { id: 'auth-1', email: 't@x.com' },
        existingTeacher: null,
      })
      const res = await handler(
        makeRequest(
          { staff_number: 'S-1', full_name: 'T', email: 't@x.com', resend_email: 't@x.com' },
          'Bearer admin'
        )
      )
      expect(res.status).toBe(404)
    })

    it('resets password successfully', async () => {
      configureClient({
        isAdmin: { id: 'admin-1', role: 'admin' },
        existingAuthUser: { id: 'auth-1', email: 't@x.com' },
        existingTeacher: { id: 'teacher-1', full_name: 'T' },
      })
      const res = await handler(
        makeRequest(
          { staff_number: 'S-1', full_name: 'T', email: 't@x.com', resend_email: 't@x.com' },
          'Bearer admin'
        )
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.message).toBe('New temporary password generated')
      expect(body.temp_password).toBeDefined()
      expect(typeof body.temp_password).toBe('string')
      expect(body.temp_password.length).toBeGreaterThanOrEqual(8)
    })

    it('returns 400 when password reset fails', async () => {
      configureClient({
        isAdmin: { id: 'admin-1', role: 'admin' },
        existingAuthUser: { id: 'auth-1', email: 't@x.com' },
        existingTeacher: { id: 'teacher-1', full_name: 'T' },
        updateUserError: { message: 'update failed' },
      })
      const res = await handler(
        makeRequest(
          { staff_number: 'S-1', full_name: 'T', email: 't@x.com', resend_email: 't@x.com' },
          'Bearer admin'
        )
      )
      expect(res.status).toBe(400)
    })
  })
})
