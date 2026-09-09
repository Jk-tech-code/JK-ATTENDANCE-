import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import '../_shared/denoShim'

type Client = {
  auth: {
    getUser: (token: string) => Promise<{ data: { user: unknown }; error: unknown }>
    admin: {
      createUser: (
        opts: unknown
      ) => Promise<{ data: { user: { id: string } | null }; error: { message: string } | null }>
      generateLink: (opts: unknown) => Promise<{
        data: { properties?: { action_link?: string } } | null
        error: { message: string } | null
      }>
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

function configureClient(opts: {
  caller?: { id: string; email?: string }
  getUserError?: { message: string }
  isAdmin?: TeacherRow | null
  existingAuthUser?: { id: string; email: string } | null
  existingTeacher?: TeacherRow | null
  createUserResult?: { id: string } | null
  createUserError?: { message: string }
  generateLinkResult?: { action_link?: string } | null
  generateLinkError?: { message: string }
  insertedTeacher?: TeacherRow | { id: string; full_name: string; email: string } | null
  insertError?: { message: string }
  onDeleteUser?: () => void
  resendSuccess?: boolean
}): Client {
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
        createUser: async () => {
          if (opts.createUserError) return { data: { user: null }, error: opts.createUserError }
          return {
            data: { user: opts.createUserResult ? { id: opts.createUserResult.id } : null },
            error: null,
          }
        },
        generateLink: async () => {
          if (opts.generateLinkError) return { data: null, error: opts.generateLinkError }
          return {
            data: {
              properties: {
                action_link:
                  opts.generateLinkResult?.action_link ??
                  'https://example.com/reset-password#token=abc',
              },
            },
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
            return {
              or: () => ({
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
      }
    },
  }

  // Mock fetch for GoTrue REST API lookup AND Resend API
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('/auth/v1/admin/users?email=')) {
      if (opts.existingAuthUser) {
        return new Response(JSON.stringify([opts.existingAuthUser]), { status: 200 })
      }
      return new Response(JSON.stringify([]), { status: 200 })
    }
    if (url.includes('api.resend.com/emails')) {
      if (opts.resendSuccess === false) {
        return new Response(JSON.stringify({ message: 'SMTP error' }), { status: 500 })
      }
      return new Response(JSON.stringify({ id: 'email-123' }), { status: 200 })
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
    process.env.RESEND_API_KEY = 're_test_key'
    process.env.SITE_URL = 'https://jk-attendance.vercel.app'
  })

  afterEach(() => {
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    delete process.env.RESEND_API_KEY
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
        createUserResult: { id: 'new-auth-1' },
        generateLinkResult: { action_link: 'https://example.com/reset-password#token=abc' },
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
    it('creates user, generates link, sends email, creates teacher record', async () => {
      let insertedRecord: Record<string, unknown> | null = null
      configureClient({
        isAdmin: { id: 'admin-1', role: 'admin' },
        existingAuthUser: null,
        existingTeacher: null,
        createUserResult: { id: 'new-auth-1' },
        generateLinkResult: { action_link: 'https://example.com/reset-password#token=abc' },
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
        createUserResult: { id: 'new-auth-1' },
        generateLinkResult: { action_link: 'https://example.com/reset-password#token=abc' },
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
    it('returns 409 when createUser reports duplicate', async () => {
      configureClient({
        isAdmin: { id: 'admin-1', role: 'admin' },
        existingAuthUser: null,
        existingTeacher: null,
        createUserError: { message: 'User already registered' },
      })
      const res = await handler(
        makeRequest({ staff_number: 'S-1', full_name: 'T', email: 't@x.com' }, 'Bearer admin')
      )
      expect(res.status).toBe(409)
    })

    it('returns 400 when createUser fails generically', async () => {
      configureClient({
        isAdmin: { id: 'admin-1', role: 'admin' },
        existingAuthUser: null,
        existingTeacher: null,
        createUserError: { message: 'Database error' },
      })
      const res = await handler(
        makeRequest({ staff_number: 'S-1', full_name: 'T', email: 't@x.com' }, 'Bearer admin')
      )
      expect(res.status).toBe(400)
    })
  })

  describe('generateLink failures', () => {
    it('returns 400 and rolls back when generateLink fails', async () => {
      let deleteCount = 0
      configureClient({
        isAdmin: { id: 'admin-1', role: 'admin' },
        existingAuthUser: null,
        existingTeacher: null,
        createUserResult: { id: 'new-auth-1' },
        generateLinkError: { message: 'link generation failed' },
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

  describe('email send failures', () => {
    it('returns 500 and rolls back when Resend API fails', async () => {
      let deleteCount = 0
      configureClient({
        isAdmin: { id: 'admin-1', role: 'admin' },
        existingAuthUser: null,
        existingTeacher: null,
        createUserResult: { id: 'new-auth-1' },
        generateLinkResult: { action_link: 'https://example.com/reset-password#token=abc' },
        resendSuccess: false,
        onDeleteUser: () => {
          deleteCount += 1
        },
      })
      const res = await handler(
        makeRequest({ staff_number: 'S-1', full_name: 'T', email: 't@x.com' }, 'Bearer admin')
      )
      expect(res.status).toBe(500)
      expect(deleteCount).toBe(1)
    })
  })
})
