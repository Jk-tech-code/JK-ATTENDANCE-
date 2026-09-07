import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import { useContext } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'

// ─── Mocks ──────────────────────────────────────────────────────
const mockSignOut = vi.fn()
const mockGetCurrentUser = vi.fn()
const mockGetUser = vi.fn()
const mockOnAuthStateChange = vi.fn()

vi.mock('@/services/supabase', () => ({
  supabase: {
    auth: {
      getUser: (...args: unknown[]) => mockGetUser(...args),
      onAuthStateChange: (...args: unknown[]) => mockOnAuthStateChange(...args),
    },
  },
}))

vi.mock('@/services/auth', () => ({
  getCurrentUser: (...args: unknown[]) => mockGetCurrentUser(...args),
  signIn: vi.fn(),
  signOut: (...args: unknown[]) => mockSignOut(...args),
  signInWithGoogle: vi.fn(),
}))

import { queryClient } from '@/lib/queryClient'
import { AuthProvider } from './AuthProvider'
import { AuthContext } from './AuthContext'

// Capture signOut from the context for the test consumer.
function Consumer() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('AuthContext missing')
  return (
    <div>
      <span data-testid="user">{ctx.user?.email ?? 'none'}</span>
      <button data-testid="signout" onClick={() => void ctx.signOut()}>
        sign out
      </button>
    </div>
  )
}

function renderWithClient() {
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    </QueryClientProvider>,
  )
}

describe('AuthProvider query cache clearing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: no active session, no user.
    mockGetCurrentUser.mockResolvedValue(null)
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null })
    mockOnAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: () => {} } },
    })
  })

  afterEach(() => {
    queryClient.clear()
  })

  it('clears the React-Query cache after a successful signOut', async () => {
    // Pre-populate the cache with data as if a teacher had been
    // signed in. We need to do this BEFORE the first signOut call so
    // the test verifies the post-signOut state, not the initial state.
    queryClient.setQueryData(['teacher-1', 'attendance'], { ok: true })
    expect(queryClient.getQueryData(['teacher-1', 'attendance'])).toEqual({ ok: true })

    mockSignOut.mockResolvedValue({ error: null })

    renderWithClient()

    await waitFor(() => {
      expect(screen.getByTestId('user').textContent).toBe('none')
    })

    await act(async () => {
      screen.getByTestId('signout').click()
    })

    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalledTimes(1)
    })

    // Cache must be empty after signOut.
    expect(queryClient.getQueryData(['teacher-1', 'attendance'])).toBeUndefined()
  })

  it('does NOT clear the cache when signOut returns an error', async () => {
    queryClient.setQueryData(['teacher-1', 'attendance'], { ok: true })
    mockSignOut.mockResolvedValue({ error: { message: 'network down' } })

    renderWithClient()

    await act(async () => {
      screen.getByTestId('signout').click()
    })

    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalledTimes(1)
    })

    // Cache survives because the signOut didn't actually succeed.
    expect(queryClient.getQueryData(['teacher-1', 'attendance'])).toEqual({ ok: true })
  })

  it('clears the cache when the auth listener fires SIGNED_OUT', async () => {
    // First render wires up onAuthStateChange and captures the
    // handler so we can invoke it manually.
    let capturedHandler: ((event: string, session: unknown) => void) | null = null
    mockOnAuthStateChange.mockImplementation((handler: (event: string, session: unknown) => void) => {
      capturedHandler = handler
      return { data: { subscription: { unsubscribe: () => {} } } }
    })

    queryClient.setQueryData(['some-key'], 'some-value')
    expect(queryClient.getQueryData(['some-key'])).toBe('some-value')

    renderWithClient()

    expect(capturedHandler).not.toBeNull()

    // Simulate Supabase firing SIGNED_OUT.
    await act(async () => {
      capturedHandler!('SIGNED_OUT', null)
    })

    expect(queryClient.getQueryData(['some-key'])).toBeUndefined()
  })
})