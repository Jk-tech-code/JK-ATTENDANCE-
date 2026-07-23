import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFrom = vi.fn()
const mockSelect = vi.fn()
const mockEq = vi.fn()
const mockMaybeSingle = vi.fn()

const mockSignInWithPassword = vi.fn()
const mockGetUser = vi.fn()
const mockSignOut = vi.fn()
const mockResetPasswordForEmail = vi.fn()

vi.mock('./supabase', () => ({
  supabase: {
    from: mockFrom,
    auth: {
      signInWithPassword: mockSignInWithPassword,
      getUser: mockGetUser,
      signOut: mockSignOut,
      resetPasswordForEmail: mockResetPasswordForEmail,
    },
  },
}))

function mockProfilesChain(data: unknown) {
  const maybeSingle = vi.fn().mockResolvedValue({ data, error: null })
  const eq = vi.fn().mockReturnValue({ maybeSingle })
  const select = vi.fn().mockReturnValue({ eq })
  const insert = vi.fn().mockReturnValue({ select })
  return { select, insert, eq, maybeSingle }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFrom.mockImplementation((table: string) => {
    if (table === 'profiles') {
      return mockProfilesChain({
        id: 'user-2',
        email: 'no-profile@school.com',
        full_name: 'Google User',
        avatar_url: null,
        role: 'teacher',
        created_at: new Date().toISOString(),
      })
    }
    return { select: mockSelect, eq: mockEq, maybeSingle: mockMaybeSingle }
  })
  mockSelect.mockReturnValue({ eq: mockEq })
  mockEq.mockReturnValue({ maybeSingle: mockMaybeSingle })
})

describe('signIn', () => {
  it('returns user with teacher on success', async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'teacher@school.com',
          user_metadata: { role: 'teacher' },
        },
      },
      error: null,
    })

    mockMaybeSingle.mockResolvedValue({
      data: {
        id: 'user-1',
        full_name: 'Test Teacher',
        staff_number: 'T001',
        email: 'teacher@school.com',
        department: 'Science',
      },
      error: null,
    })

    const { signIn } = await import('./auth')
    const result = await signIn('teacher@school.com', 'password123')

    expect(result.error).toBeNull()
    expect(result.user).not.toBeNull()
    expect(result.user!.id).toBe('user-1')
    expect(result.user!.teacher).not.toBeNull()
    expect(result.user!.teacher!.full_name).toBe('Test Teacher')
    expect(result.user!.role).toBe('teacher')
  })

  it('returns error on auth failure', async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { message: 'Invalid credentials' },
    })

    const { signIn } = await import('./auth')
    const result = await signIn('bad@email.com', 'wrong')

    expect(result.user).toBeNull()
    expect(result.error).toBe('Invalid credentials')
  })
})

describe('getCurrentUser', () => {
  it('returns null when no session', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'No session' },
    })

    const { getCurrentUser } = await import('./auth')
    const result = await getCurrentUser()

    expect(result).toBeNull()
  })

  it('returns user with null teacher and profile when teacher missing', async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-2',
          email: 'no-profile@school.com',
          user_metadata: { role: 'teacher' },
        },
      },
      error: null,
    })

    mockMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'No teacher found' },
    })

    const { getCurrentUser } = await import('./auth')
    const result = await getCurrentUser()

    expect(result).not.toBeNull()
    expect(result!.id).toBe('user-2')
    expect(result!.teacher).toBeNull()
    expect(result!.profile).not.toBeNull()
    expect(result!.profile!.full_name).toBe('Google User')
    expect(result!.role).toBe('teacher')
  })
})

describe('signOut', () => {
  it('returns null error on success', async () => {
    mockSignOut.mockResolvedValue({ error: null })

    const { signOut } = await import('./auth')
    const result = await signOut()

    expect(result.error).toBeNull()
  })
})
