import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import '../_shared/denoShim'

type Client = {
  auth: { getUser: (token: string) => Promise<{ data: { user: unknown }; error: unknown }> }
  rpc: (name: string, args?: unknown) => Promise<{ data: unknown; error: unknown }>
  from: (table: string) => unknown
}

interface TeacherRow {
  id: string
  full_name?: string
  staff_number?: string
  email?: string
  role?: string
}

// Counter shared across from() calls. The handler calls isAdmin
// (which calls from('teachers').select('id')) and then a duplicate
// /callerTeacher lookup. We need to distinguish these by call order.
const teacherIdSelectCount = { count: 0 }

function configureClient(opts: {
  caller?: { id: string; email?: string }
  getUserError?: { message: string }
  isAdmin?: TeacherRow | null
  callerTeacher?: TeacherRow | null
  notifications?: unknown[]
  notificationsError?: { message: string }
}): void {
  teacherIdSelectCount.count = 0
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
    rpc: async () => ({ data: null, error: null }),
    from: (table: string) => {
      if (table === 'teachers') {
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
              // callerTeacher lookup: .or(...).maybeSingle()
              return {
                or: () => ({
                  maybeSingle: async () => ({
                    data: opts.callerTeacher ?? null,
                    error: null,
                  }),
                }),
              }
            }
            throw new Error('Unexpected teachers select cols: ' + cols)
          },
        }
      }
      if (table === 'attendance_notifications') {
        // Track what filter was applied so we can assert in tests.
        const captured: { teacherId?: string; limit?: number } = {}
        const builder: Record<string, unknown> = {
          select: () => builder,
          order: () => builder,
          limit: (n: number) => {
            captured.limit = n
            return builder
          },
          eq: (col: string, val: unknown) => {
            if (col === 'teacher_id') captured.teacherId = String(val)
            return builder
          },
        }
        // Make the chain awaitable.
        const promise = (async () => ({
          data: opts.notificationsError ? null : opts.notifications ?? [],
          error: opts.notificationsError ?? null,
        }))()
        // Allow await by also being a thenable object.
        Object.assign(builder, promise)
        ;(builder as { then: unknown }).then = promise.then.bind(promise)
        return builder
      }
      throw new Error(`Unexpected from(${table})`)
    },
  }
  globalThis.__MOCK_SUPABASE__.createClient = () => client
}

const { handler } = await import('./index')

function makeGetRequest(query = '', authHeader?: string): Request {
  const headers: Record<string, string> = {}
  if (authHeader) headers.authorization = authHeader
  return new Request(`https://example.com/functions/v1/attendance-notification${query}`, {
    method: 'GET',
    headers,
  })
}

describe('attendance-notification (GET ownership enforcement)', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k'
  })

  afterEach(() => {
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
  })

  it('rejects requests with no Authorization header', async () => {
    configureClient({})
    const res = await handler(makeGetRequest())
    expect(res.status).toBe(401)
  })

  it('rejects requests with a non-Bearer Authorization header', async () => {
    configureClient({})
    const res = await handler(
      new Request('https://example.com/functions/v1/attendance-notification', {
        method: 'GET',
        headers: { authorization: 'Basic xyz' },
      }),
    )
    expect(res.status).toBe(401)
  })

  it('non-admin caller without a teacher row gets an empty list, not an error', async () => {
    configureClient({
      caller: { id: 'no-teacher-uid' },
      isAdmin: null,
      callerTeacher: null,
    })
    const res = await handler(makeGetRequest('', 'Bearer no-teacher-uid'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.notifications).toEqual([])
  })

  it('non-admin caller can fetch their own notifications', async () => {
    configureClient({
      caller: { id: 'teacher-uid-1', email: 't@school.com' },
      isAdmin: null,
      callerTeacher: { id: 'teacher-1' },
      notifications: [{ id: 'n-1', teacher_id: 'teacher-1' }],
    })
    const res = await handler(makeGetRequest('', 'Bearer teacher-uid-1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.notifications).toHaveLength(1)
  })

  it('non-admin caller asking for another teacher gets 403 (the security fix)', async () => {
    configureClient({
      caller: { id: 'teacher-uid-1', email: 't@school.com' },
      isAdmin: null,
      callerTeacher: { id: 'teacher-1' },
    })
    const res = await handler(
      makeGetRequest('?teacher_id=teacher-99', 'Bearer teacher-uid-1'),
    )
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('Forbidden')
  })

  it('non-admin caller passing their own teacher_id gets only their notifications', async () => {
    configureClient({
      caller: { id: 'teacher-uid-1', email: 't@school.com' },
      isAdmin: null,
      callerTeacher: { id: 'teacher-1' },
      notifications: [{ id: 'n-1', teacher_id: 'teacher-1' }],
    })
    const res = await handler(
      makeGetRequest('?teacher_id=teacher-1', 'Bearer teacher-uid-1'),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.notifications).toHaveLength(1)
  })

  it('admin caller can fetch any teacher_id', async () => {
    configureClient({
      caller: { id: 'admin-uid', email: 'admin@school.com' },
      isAdmin: { id: 'admin-1', role: 'admin' },
      notifications: [{ id: 'n-1', teacher_id: 'teacher-99' }],
    })
    const res = await handler(
      makeGetRequest('?teacher_id=teacher-99', 'Bearer admin-uid'),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.notifications).toHaveLength(1)
  })

  it('admin caller can omit teacher_id to fetch any notifications', async () => {
    configureClient({
      caller: { id: 'admin-uid' },
      isAdmin: { id: 'admin-1', role: 'admin' },
      notifications: [{ id: 'n-1' }, { id: 'n-2' }],
    })
    const res = await handler(makeGetRequest('', 'Bearer admin-uid'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.notifications).toHaveLength(2)
  })

  it('caps the limit parameter at 100 to prevent unbounded result sets', async () => {
    configureClient({
      caller: { id: 'admin-uid' },
      isAdmin: { id: 'admin-1', role: 'admin' },
    })
    const res = await handler(
      makeGetRequest('?limit=99999', 'Bearer admin-uid'),
    )
    expect(res.status).toBe(200)
  })

  it('rejects non-GET/POST methods with 405', async () => {
    configureClient({})
    const res = await handler(
      new Request('https://example.com/functions/v1/attendance-notification', {
        method: 'PUT',
        headers: { authorization: 'Bearer admin' },
      }),
    )
    expect(res.status).toBe(405)
  })
})