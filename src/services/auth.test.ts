import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFrom = vi.fn()
const mockSelect = vi.fn()
const mockEq = vi.fn()
const mockSingle = vi.fn()

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

beforeEach(() => {
  vi.clearAllMocks()
  mockFrom.mockReturnValue({ select: mockSelect })
  mockSelect.mockReturnValue({ eq: mockEq })
  mockEq.mockReturnValue({ single: mockSingle })
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

    mockSingle.mockResolvedValue({
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

  it('returns user with null teacher when profile missing', async () => {
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

    mockSingle.mockResolvedValue({
      data: null,
      error: { message: 'No teacher found' },
    })

    const { getCurrentUser } = await import('./auth')
    const result = await getCurrentUser()

    expect(result).not.toBeNull()
    expect(result!.id).toBe('user-2')
    expect(result!.teacher).toBeNull()
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
