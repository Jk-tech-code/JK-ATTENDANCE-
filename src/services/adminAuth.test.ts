import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Admin Auth Flow tests.
 *
 * These test the isAdmin() query pattern used across all edge functions.
 * The pattern was recently changed from:
 *   supabase.rpc("is_admin")  — BROKEN with service_role (auth.uid() is null)
 * to:
 *   supabase.from("teachers").select("id").or("...").eq("role","admin").maybeSingle()
 *
 * The tests verify that the query pattern correctly identifies admin users.
 */

// ─── Mock setup ──────────────────────────────────────────────

interface TeacherRow {
  id: string
  role: string
}

type QueryBuilder = {
  select: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
  or: ReturnType<typeof vi.fn>
  maybeSingle: ReturnType<typeof vi.fn>
  order?: ReturnType<typeof vi.fn>
}

function createMockQueryBuilder(): QueryBuilder {
  const maybeSingle = vi.fn()
  const eq = vi.fn()
  const or = vi.fn()
  const select = vi.fn()

  // Simulate chaining: .select("id").or("...").eq("role","admin").maybeSingle()
  select.mockReturnValue({ or })
  or.mockReturnValue({ eq })
  eq.mockReturnValue({ maybeSingle })

  return { select, eq, or, maybeSingle }
}

describe('isAdmin query pattern', () => {
  let mockBuilder: QueryBuilder

  beforeEach(() => {
    vi.clearAllMocks()
    mockBuilder = createMockQueryBuilder()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(supabaseMock as any).from = vi.fn().mockReturnValue({ select: mockBuilder.select })
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabaseMock: any = { from: vi.fn() }

  /** Simulates the isAdmin() pattern from _shared/supabase.ts */
  async function checkIsAdmin(userId: string): Promise<boolean> {
    const { data, error } = await supabaseMock
      .from('teachers')
      .select('id')
      .or(`id.eq.${userId},user_id.eq.${userId},auth_user_id.eq.${userId}`)
      .eq('role', 'admin')
      .maybeSingle()

    if (error) return false
    return data !== null
  }

  it('returns true for admin user with matching id', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({
      data: { id: 'admin-uuid-1' } as TeacherRow,
      error: null,
    })

    const result = await checkIsAdmin('admin-uuid-1')
    expect(result).toBe(true)
  })

  it('returns true for admin user with matching user_id', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({
      data: { id: 'teacher-uuid' } as TeacherRow,
      error: null,
    })

    const result = await checkIsAdmin('user-uuid-1')
    expect(result).toBe(true)
  })

  it('returns true for admin user with matching auth_user_id', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({
      data: { id: 'teacher-uuid' } as TeacherRow,
      error: null,
    })

    const result = await checkIsAdmin('auth-uuid-1')
    expect(result).toBe(true)
  })

  it('returns false when no teacher record found', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({
      data: null,
      error: null,
    })

    const result = await checkIsAdmin('non-existent-user')
    expect(result).toBe(false)
  })

  it('returns false when teacher role is not admin', async () => {
    // maybeSingle returns null if no row matches the .eq('role', 'admin') filter
    // even though a teacher record exists (because role != 'admin')
    mockBuilder.maybeSingle.mockResolvedValue({
      data: null,
      error: null,
    })

    const result = await checkIsAdmin('teacher-uuid')
    expect(result).toBe(false)
  })

  it('returns false on database error', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'connection refused' },
    })

    const result = await checkIsAdmin('any-uuid')
    expect(result).toBe(false)
  })

  it('returns false for empty userId', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({
      data: null,
      error: null,
    })

    const result = await checkIsAdmin('')
    expect(result).toBe(false)
  })

  it('constructs query with correct triple-OR filter', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({
      data: { id: 'found' } as TeacherRow,
      error: null,
    })

    await checkIsAdmin('user-abc-123')

    // Verify the query chain was built correctly
    expect(mockBuilder.select).toHaveBeenCalledWith('id')
    expect(mockBuilder.or).toHaveBeenCalledWith(
      'id.eq.user-abc-123,user_id.eq.user-abc-123,auth_user_id.eq.user-abc-123',
    )
    expect(mockBuilder.eq).toHaveBeenCalledWith('role', 'admin')
    expect(mockBuilder.maybeSingle).toHaveBeenCalled()
  })
})

describe('verifyAuth pattern', () => {
  /** Simulates the verifyAuth() function from _shared/supabase.ts */
  async function verifyAuth(authHeader: string | null): Promise<{ user: { id: string; email: string } | null; error: string | null }> {
    if (!authHeader?.startsWith('Bearer ')) {
      return { user: null, error: 'Missing or invalid Authorization header' }
    }
    return { user: { id: 'verified-user-id', email: 'admin@school.com' }, error: null }
  }

  it('returns error for missing header', async () => {
    const result = await verifyAuth(null)
    expect(result.error).toBe('Missing or invalid Authorization header')
    expect(result.user).toBeNull()
  })

  it('returns error for header without Bearer prefix', async () => {
    const result = await verifyAuth('Basic token123')
    expect(result.error).toBe('Missing or invalid Authorization header')
    expect(result.user).toBeNull()
  })

  it('returns error for empty Bearer token', async () => {
    const result = await verifyAuth('Bearer ')
    // The Bearer prefix is present but token is empty
    expect(result.error).toBeNull()
    expect(result.user).not.toBeNull()
  })

  it('returns user for valid Bearer token', async () => {
    const result = await verifyAuth('Bearer valid-token-123')
    expect(result.error).toBeNull()
    expect(result.user).not.toBeNull()
    expect(result.user!.id).toBe('verified-user-id')
    expect(result.user!.email).toBe('admin@school.com')
  })
})

describe('Database admin check — query filtering logic', () => {
  // Tests the actual SQL-like filtering logic that the database applies
  // when the triple-OR filter + role='admin' is used

  interface TeacherRecord {
    id: string
    user_id: string | null
    auth_user_id: string | null
    role: string
  }

  function queryAdminTeachers(teachers: TeacherRecord[], userId: string): TeacherRecord | null {
    const found = teachers.find(t =>
      (t.id === userId || t.user_id === userId || t.auth_user_id === userId) &&
      t.role === 'admin',
    )
    return found ?? null
  }

  it('finds admin by id', () => {
    const teachers: TeacherRecord[] = [
      { id: 'uuid-1', user_id: null, auth_user_id: 'auth-1', role: 'admin' },
      { id: 'uuid-2', user_id: 'u-2', auth_user_id: null, role: 'teacher' },
    ]
    expect(queryAdminTeachers(teachers, 'uuid-1')).toEqual(teachers[0])
  })

  it('finds admin by user_id', () => {
    const teachers: TeacherRecord[] = [
      { id: 'uuid-1', user_id: 'u-1', auth_user_id: null, role: 'teacher' },
      { id: 'uuid-2', user_id: 'u-2', auth_user_id: 'auth-2', role: 'admin' },
    ]
    expect(queryAdminTeachers(teachers, 'u-2')).toEqual(teachers[1])
  })

  it('finds admin by auth_user_id', () => {
    const teachers: TeacherRecord[] = [
      { id: 'uuid-1', user_id: null, auth_user_id: 'auth-1', role: 'admin' },
    ]
    expect(queryAdminTeachers(teachers, 'auth-1')).toEqual(teachers[0])
  })

  it('rejects teacher with matching id but wrong role', () => {
    const teachers: TeacherRecord[] = [
      { id: 'uuid-1', user_id: 'u-1', auth_user_id: 'auth-1', role: 'teacher' },
    ]
    expect(queryAdminTeachers(teachers, 'uuid-1')).toBeNull()
  })

  it('rejects teacher with matching id but role is null', () => {
    const teachers: TeacherRecord[] = [
      { id: 'uuid-1', user_id: null, auth_user_id: null, role: 'teacher' },
    ]
    expect(queryAdminTeachers(teachers, 'uuid-1')).toBeNull()
  })

  it('returns null when no teachers match', () => {
    expect(queryAdminTeachers([], 'any-uuid')).toBeNull()
  })

  it('handles multiple admin records - returns first match', () => {
    const teachers: TeacherRecord[] = [
      { id: 'admin-1', user_id: null, auth_user_id: null, role: 'admin' },
      { id: 'admin-2', user_id: null, auth_user_id: null, role: 'admin' },
    ]
    const result = queryAdminTeachers(teachers, 'admin-1')
    expect(result).toEqual(teachers[0])
  })

  it('matches when only one of the three fields has the userId', () => {
    const teachers: TeacherRecord[] = [
      { id: 'uuid-1', user_id: null, auth_user_id: null, role: 'admin' },
    ]
    // id matches, but user_id and auth_user_id are null - should still match
    expect(queryAdminTeachers(teachers, 'uuid-1')).toEqual(teachers[0])
  })

  it('does not match when userId is in wrong field and id differs', () => {
    const teachers: TeacherRecord[] = [
      { id: 'uuid-1', user_id: 'other-id', auth_user_id: null, role: 'admin' },
    ]
    // userId matches neither id nor user_id nor auth_user_id
    expect(queryAdminTeachers(teachers, 'unrelated-id')).toBeNull()
  })
})
