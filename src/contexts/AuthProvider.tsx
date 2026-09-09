import { useState, useEffect, useCallback, type ReactNode } from 'react'
import type { AuthUser } from '@/types'
import { supabase } from '@/services/supabase'
import {
  getCurrentUser,
  signIn as authSignIn,
  signOut as authSignOut,
  signInWithGoogle as authSignInWithGoogle,
} from '@/services/auth'
import { queryClient } from '@/lib/queryClient'
import { cleanupPrivateApiCaches } from '@/lib/privateCacheCleanup'
import { AuthContext } from './AuthContext'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [profileError, setProfileError] = useState<string | null>(null)

  const loadUser = useCallback(async () => {
    const currentUser = await getCurrentUser()
    setUser(currentUser)
    if (currentUser && !currentUser.teacher && !currentUser.profile) {
      setProfileError('Teacher profile not found. Contact your administrator.')
    } else {
      setProfileError(null)
    }
  }, [])

  const refreshProfile = useCallback(async () => {
    setProfileError(null)
    const currentUser = await getCurrentUser()
    setUser(currentUser)
    if (currentUser && !currentUser.teacher && !currentUser.profile) {
      setProfileError('Teacher profile not found. Contact your administrator.')
    }
  }, [])

  useEffect(() => {
    const init = async () => {
      try {
        await loadUser()
      } catch (err) {
        console.error('[AuthProvider] init failed', err)
      } finally {
        setLoading(false)
      }
    }
    void init()

    const { data: listener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'TOKEN_REFRESHED') return
      if (session?.user) {
        try {
          await loadUser()
        } catch (err) {
          console.error('[AuthProvider] auth state change failed', err)
        }
      } else {
        // SIGNED_OUT (or any non-refresh event with no session):
        // clear React-Query cache so the next session does not see
        // stale data from the previous user. queryClient.clear() also
        // cancels in-flight queries and resets query state.
        setUser(null)
        setProfileError(null)
        queryClient.clear()
        // H1 defense-in-depth: sweep any private Supabase API responses out
        // of CacheStorage so they cannot outlive this session on a shared
        // device. Fire-and-forget — never block the auth callback.
        void cleanupPrivateApiCaches()
      }
    })

    return () => listener?.subscription.unsubscribe()
  }, [loadUser])

  const signIn = async (email: string, password: string) => {
    const result = await authSignIn(email, password)
    if (result.user) {
      setUser(result.user)
      if (!result.user.teacher && !result.user.profile) {
        setProfileError('Teacher profile not found. Contact your administrator.')
      } else {
        setProfileError(null)
      }
    }
    return { error: result.error, user: result.user }
  }

  const signInWithGoogle = async () => {
    try {
      await authSignInWithGoogle()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Google sign-in failed'
      setProfileError(message)
      throw err
    }
  }

  const signOut = async () => {
    const result = await authSignOut()
    if (!result.error) {
      setUser(null)
      setProfileError(null)
      // Clear cached query data so the next user (or a fresh login by
      // the same user on a shared device) does not see the previous
      // user's data. Also cancels pending queries.
      queryClient.clear()
      // H1 defense-in-depth: also sweep CacheStorage on the explicit
      // sign-out path (covers cases where the SIGNED_OUT event is delayed).
      void cleanupPrivateApiCaches()
    }
    return result
  }

  return (
    <AuthContext.Provider
      value={{ user, loading, profileError, refreshProfile, signIn, signOut, signInWithGoogle }}
    >
      {children}
    </AuthContext.Provider>
  )
}
