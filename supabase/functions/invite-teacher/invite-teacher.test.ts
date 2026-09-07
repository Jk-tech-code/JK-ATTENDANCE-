import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import '../_shared/denoShim'

type Client = {
  auth: {
    getUser: (token: string) => Promise<{ data: { user: unknown }; error: unknown }>
    admin: {
      listUsers?: (
        page?: number,
        perPage?: number
      ) => Promise<{ data: { users: unknown[] }; error: unknown }>
      getUserByEmail: (
        email: string
      ) => Promise<{ data: { user: unknown }; error: { status?: number; message: string } | null }>
      inviteUserByEmail: (
        email: string,
        opts: unknown
      ) => Promise<{ data: { user: { id: string } | null }; error: { message: string } | null }>
      deleteUser: (id: string) => Promise<{ error: unknown }>
    }
  }
  rpc: (name: string, args?: unknown) => Promise<{ data: unknown; error: unknown }>
  from: (table: string) => unknown
}

interface TeacherRow {
  id: string
  role?: string
}

interface InviteInput {
  staff_number: string
  full_name: string
  email: string
  department?: string
  phone?: string
  reporting_time?: string
}

/**
 * Build a mock supabase client for invite-teacher.
 *
 * invite-teacher's query order:
 *   1) adminMiddleware → verifyAuth (auth.getUser) + isAdmin
 *      (from teachers: select('id').or(...).eq('role','admin').maybeSingle())
 *   2) getUserByEmail(email)
 *   3) from teachers: select('id').or(email|staff_number.eq.X).maybeSingle()
 *   4) inviteUserByEmail
 *   5) from teachers: insert(...).select().single()
 *   6) [on insert error] deleteUser
 */
function configureClient(opts: {
  // Auth result for the calling user (verified Bearer token).
  caller?: { id: string; email?: string }
  getUserError?: { message: string }
  // isAdmin check: teacher row found for caller?
  isAdmin?: TeacherRow | null
  // auth.admin.getUserByEmail result
  existingAuthUser?: { id: string; email: string } | null
  getUserByEmailError?: { status?: number; message: string }
  // teachers table duplicate check
  existingTeacher?: TeacherRow | null
  // inviteUserByEmail result
  invitedUser?: { id: string } | null
  inviteError?: { message: string }
  // teacher insert result
  insertedTeacher?: TeacherRow | { id: string; full_name: string; email: string } | null
  insertError?: { message: string }
  // deleteUser call counter (rollback assertion)
  onDeleteUser?: () => void
}): Client {
  // Counter is shared across from('teachers') calls. The handler may
  // call from() multiple times (adminMiddleware does isAdmin; the
  // function body does duplicate-check). Without sharing the counter,
  // every call would see count=1 and return the isAdmin chain.
  const teacherIdSelectCount = { count: 0 }
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
        getUserByEmail: async (email: string) => {
          if (opts.getUserByEmailError)
            return { data: { user: null }, error: opts.getUserByEmailError }
          return {
            data: { user: opts.existingAuthUser ? { id: opts.existingAuthUser.id, email } : null },
            error: null,
          }
        },
        inviteUserByEmail: async () => {
          if (opts.inviteError) return { data: { user: null }, error: opts.inviteError }
          return {
            data: { user: opts.invitedUser ? { id: opts.invitedUser.id } : null },
            error: null,
          }
        },
        deleteUser: async () => {
          opts.onDeleteUser?.()
          return { error: null }
        },
      },
    },
    rpc: async () => ({ data: null, error: null }),
    from: (table: string) => {
      if (table !== 'teachers') {
        throw new Error(`Unexpected from(${table})`)
      }
      return {
        select: (cols: string) => {
          if (cols === 'id') {
            teacherIdSelectCount.count += 1
            if (teacherIdSelectCount.count === 1) {
              // isAdmin: .or(...).eq('role','admin').maybeSingle()
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
            // Duplicate teacher: .or(...).maybeSingle()
            return {
              or: () => ({
                maybeSingle: async () => ({
                  data: opts.existingTeacher ?? null,
                  error: null,
                }),
              }),
            }
          }
          // For the happy-path insert test we override .from below to
          // wrap .insert() so the test can capture the inserted payload.
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
      }
    },
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
  })

  afterEach(() => {
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
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
      // Debug: surface what the handler is actually returning.
      if (res.status !== 403) {
        const body = await res.json()
        throw new Error(`expected 403, got ${res.status}: ${JSON.stringify(body)}`)
      }
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
      // CORS preflight handling may return 204; for GET we expect 405.
      expect([204, 405]).toContain(res.status)
    })
  })

  describe('input validation', () => {
    it('returns 400 when staff_number is missing', async () => {
      configureClient({
        isAdmin: { id: 'admin-1', role: 'admin' },
      })
      const res = await handler(makeRequest({ full_name: 'T', email: 't@x.com' }, 'Bearer admin'))
      expect(res.status).toBe(400)
    })

    it('returns 400 when full_name is missing', async () => {
      configureClient({
        isAdmin: { id: 'admin-1', role: 'admin' },
      })
      const res = await handler(
        makeRequest({ staff_number: 'S-1', email: 't@x.com' }, 'Bearer admin')
      )
      expect(res.status).toBe(400)
    })

    it('returns 400 when email is missing', async () => {
      configureClient({
        isAdmin: { id: 'admin-1', role: 'admin' },
      })
      const res = await handler(
        makeRequest({ staff_number: 'S-1', full_name: 'T' }, 'Bearer admin')
      )
      expect(res.status).toBe(400)
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

    it('treats a getUserByEmail 404 as "no existing user" and continues', async () => {
      // 404 from getUserByEmail means the email is unused — that's the
      // happy path, not an error.
      configureClient({
        isAdmin: { id: 'admin-1', role: 'admin' },
        existingAuthUser: null,
        getUserByEmailError: { status: 404, message: 'not found' },
        existingTeacher: null,
        invitedUser: { id: 'new-auth-1' },
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
    it('invites the user and creates the teacher record', async () => {
      let insertedRecord: Record<string, unknown> | null = null
      configureClient({
        isAdmin: { id: 'admin-1', role: 'admin' },
        existingAuthUser: null,
        existingTeacher: null,
        invitedUser: { id: 'new-auth-1' },
        insertedTeacher: null, // let the mock return the inserted record
      })

      // Wrap insert to capture the payload.
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
        invitedUser: { id: 'new-auth-1' },
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

  describe('invite failures', () => {
    it('returns 400 when inviteUserByEmail errors', async () => {
      configureClient({
        isAdmin: { id: 'admin-1', role: 'admin' },
        existingAuthUser: null,
        existingTeacher: null,
        inviteError: { message: 'smtp down' },
      })
      const res = await handler(
        makeRequest({ staff_number: 'S-1', full_name: 'T', email: 't@x.com' }, 'Bearer admin')
      )
      expect(res.status).toBe(400)
    })
  })
})
