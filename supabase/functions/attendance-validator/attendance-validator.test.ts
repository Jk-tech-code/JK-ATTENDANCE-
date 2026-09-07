import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import '../_shared/denoShim'

type Client = {
  auth: { getUser: (token: string) => Promise<{ data: { user: unknown }; error: unknown }> }
  rpc: (name: string, args?: unknown) => Promise<{ data: unknown; error: unknown }>
  from: (table: string) => unknown
}

interface SettingsRow {
  reporting_start_time?: string
  default_reporting_time?: string
  grace_period_minutes?: number
  checkout_time?: string
  active?: boolean
}

interface TeacherRow {
  id: string
  full_name: string
  staff_number: string
  role?: string
}

/**
 * Build a mock supabase client whose `from(table)` dispatch table is
 * driven by the test. Each table handler returns a builder object
 * whose methods can be configured independently.
 */
function configureClient(opts: {
  user?: { id: string; email?: string }
  getUserError?: { message: string }
  // For each teachers query, declare what should be returned.
  // The validator issues up to 3 teachers queries in order:
  //   1) isAdmin check — select('id').or(id|user|auth.eq.u).eq('role','admin').maybeSingle()
  //   2) [non-admin only] callerTeacher lookup — select('id').or(id|user|auth.eq.u).maybeSingle()
  //   3) teacher fetch — select('id, full_name, staff_number').eq('id', body.teacher_id).maybeSingle()
  isAdmin?: TeacherRow | null
  callerTeacher?: TeacherRow | null
  teacher?: TeacherRow | null
  settings?: SettingsRow | null
}): Client {
  let idCalls = 0
  const client: Client = {
    auth: {
      getUser: opts.getUserError
        ? async () => ({ data: { user: null }, error: opts.getUserError })
        : async () => ({
            data: { user: { id: opts.user?.id ?? 'u-1', email: opts.user?.email ?? 'a@b.com' } },
            error: null,
          }),
    },
    rpc: async () => ({ data: null, error: null }),
    from: (table: string) => {
      if (table === 'teachers') {
        return {
          select: (cols: string) => {
            if (cols === 'id') {
              idCalls += 1
              const callNumber = idCalls
              const data =
                callNumber === 1
                  ? opts.isAdmin ?? null
                  : opts.callerTeacher ?? null
              // The isAdmin query chains: .or(...).eq('role','admin').maybeSingle()
              // The callerTeacher query chains: .or(...).maybeSingle()
              if (callNumber === 1) {
                return {
                  or: () => ({
                    eq: () => ({
                      maybeSingle: async () => ({ data, error: null }),
                    }),
                  }),
                }
              }
              return {
                or: () => ({
                  maybeSingle: async () => ({ data, error: null }),
                }),
              }
            }
            // Full teacher record fetch (col list contains full_name, staff_number)
            return {
              eq: () => ({
                maybeSingle: async () => ({
                  data: opts.teacher ?? null,
                  error: null,
                }),
              }),
            }
          },
        }
      }
      if (table === 'school_settings') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: opts.settings ?? null,
                error: null,
              }),
            }),
          }),
        }
      }
      throw new Error(`Unexpected from(${table})`)
    },
  }
  globalThis.__MOCK_SUPABASE__.createClient = () => client
  return client
}

const { handler } = await import('./index')

function makeRequest(body: unknown, authHeader = 'Bearer t-1'): Request {
  return new Request('https://example.com/functions/v1/attendance-validator', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: authHeader,
    },
    body: JSON.stringify(body),
  })
}

const baseTeacher: TeacherRow = {
  id: 't-self',
  full_name: 'Jane Doe',
  staff_number: 'S-1',
}
const baseSettings: SettingsRow = {
  reporting_start_time: '07:00',
  grace_period_minutes: 20,
  checkout_time: '17:30',
}

describe('attendance-validator', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k'
  })

  afterEach(() => {
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
  })

  describe('authz', () => {
    it('rejects requests with no Authorization header', async () => {
      configureClient({})
      const res = await handler(
        new Request('https://example.com/functions/v1/attendance-validator', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ teacher_id: 't-1', attendance_date: '2026-09-01' }),
        }),
      )
      expect(res.status).toBe(401)
    })

    it('rejects requests with a non-Bearer Authorization header', async () => {
      configureClient({})
      const res = await handler(
        new Request('https://example.com/functions/v1/attendance-validator', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Basic xyz' },
          body: JSON.stringify({ teacher_id: 't-1', attendance_date: '2026-09-01' }),
        }),
      )
      expect(res.status).toBe(401)
    })

    it('rejects when the Bearer token cannot be verified', async () => {
      configureClient({ getUserError: { message: 'bad jwt' } })
      const res = await handler(makeRequest({ teacher_id: 't-1', attendance_date: '2026-09-01' }))
      expect(res.status).toBe(401)
    })

    it('rejects non-admin callers who try to validate another teacher', async () => {
      configureClient({
        isAdmin: null, // not admin
        callerTeacher: { id: 't-self', full_name: 'Jane', staff_number: 'S-1' },
      })

      const res = await handler(
        makeRequest({ teacher_id: 't-other', attendance_date: '2026-09-01' }),
      )
      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.error).toBe('Forbidden')
    })

    it('rejects non-admin callers with no matching teacher row', async () => {
      configureClient({
        isAdmin: null,
        callerTeacher: null,
      })

      const res = await handler(
        makeRequest({ teacher_id: 't-1', attendance_date: '2026-09-01' }),
      )
      expect(res.status).toBe(403)
    })

    it('allows non-admin callers to validate their own teacher_id', async () => {
      configureClient({
        isAdmin: null,
        callerTeacher: baseTeacher,
        teacher: baseTeacher,
        settings: baseSettings,
      })

      const res = await handler(
        makeRequest({
          teacher_id: baseTeacher.id,
          attendance_date: '2026-09-01',
          check_in: '07:30:00',
          check_out: '17:30:00',
        }),
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      // 07:30 is within grace (07:00 + 20min = 07:20), so COMPLETE_DAY
      // requires checkIn <= graceEnd. 07:30 > 07:20 — so it's LATE.
      expect(body.success).toBe(true)
      expect(body.validated.status).toBe('LATE')
      expect(body.validated.late_minutes).toBe(10)
    })

    it('allows admin callers to validate any teacher_id', async () => {
      configureClient({
        isAdmin: { id: 'admin-1', full_name: 'Admin', staff_number: 'A-1', role: 'admin' },
        teacher: { id: 't-99', full_name: 'Other Teacher', staff_number: 'S-99' },
        settings: baseSettings,
      })

      const res = await handler(
        makeRequest(
          {
            teacher_id: 't-99',
            attendance_date: '2026-09-01',
            check_in: '07:30:00',
            check_out: '17:30:00',
          },
          'Bearer admin',
        ),
      )
      expect(res.status).toBe(200)
    })
  })

  describe('input validation', () => {
    it('returns 400 when teacher_id is missing', async () => {
      configureClient({})
      const res = await handler(makeRequest({ attendance_date: '2026-09-01' }))
      expect(res.status).toBe(400)
    })

    it('returns 400 when attendance_date is missing', async () => {
      configureClient({})
      const res = await handler(makeRequest({ teacher_id: 't-1' }))
      expect(res.status).toBe(400)
    })

    it('returns 404 when the teacher row does not exist', async () => {
      configureClient({
        isAdmin: { id: 'admin-1', full_name: 'A', staff_number: 'A', role: 'admin' },
        teacher: null,
      })
      const res = await handler(
        makeRequest({ teacher_id: 'ghost', attendance_date: '2026-09-01' }, 'Bearer admin'),
      )
      expect(res.status).toBe(404)
    })
  })

  describe('status computation (regression coverage)', () => {
    function runAsAdmin(body: unknown): Promise<{
      status: number
      body: {
        validated?: {
          status: string
          late_minutes?: number
          working_hours?: string
          early_departure_minutes?: number
        }
      }
    }> {
      configureClient({
        isAdmin: { id: 'admin-1', full_name: 'A', staff_number: 'A', role: 'admin' },
        teacher: { id: 't-1', full_name: 'T', staff_number: 'S' },
        settings: baseSettings,
      })
      return handler(makeRequest(body, 'Bearer admin')).then(async (res) => ({
        status: res.status,
        body: await res.json(),
      }))
    }

    it('classifies on-time check-in + on-time check-out as COMPLETE_DAY', async () => {
      const r = await runAsAdmin({
        teacher_id: 't-1',
        attendance_date: '2026-09-01',
        check_in: '07:15:00',
        check_out: '17:30:00',
      })
      expect(r.status).toBe(200)
      expect(r.body.validated?.status).toBe('COMPLETE_DAY')
    })

    it('classifies late check-in as LATE with late_minutes', async () => {
      const r = await runAsAdmin({
        teacher_id: 't-1',
        attendance_date: '2026-09-01',
        check_in: '08:00:00',
        check_out: '17:30:00',
      })
      expect(r.body.validated?.status).toBe('LATE')
      // Late = 08:00 - (07:00 + 20 min) = 40 minutes
      expect(r.body.validated?.late_minutes).toBe(40)
    })

    it('classifies early departure as EARLY_DEPARTURE', async () => {
      const r = await runAsAdmin({
        teacher_id: 't-1',
        attendance_date: '2026-09-01',
        check_in: '07:15:00',
        check_out: '15:00:00',
      })
      expect(r.body.validated?.status).toBe('EARLY_DEPARTURE')
    })

    it('classifies neither check-in nor check-out as ABSENT', async () => {
      const r = await runAsAdmin({
        teacher_id: 't-1',
        attendance_date: '2026-09-01',
      })
      expect(r.body.validated?.status).toBe('ABSENT')
    })

    it('computes working_hours as H hrs M mins', async () => {
      const r = await runAsAdmin({
        teacher_id: 't-1',
        attendance_date: '2026-09-01',
        check_in: '07:00:00',
        check_out: '17:30:00',
      })
      expect(r.body.validated?.working_hours).toBe('10 hrs 30 mins')
    })
  })

  describe('HTTP method handling', () => {
    it('returns 405 for GET', async () => {
      configureClient({})
      const res = await handler(
        new Request('https://example.com/functions/v1/attendance-validator', {
          method: 'GET',
          headers: { authorization: 'Bearer t-1' },
        }),
      )
      expect(res.status).toBe(405)
    })
  })
})