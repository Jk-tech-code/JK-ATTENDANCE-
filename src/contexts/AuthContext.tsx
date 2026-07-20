import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import type { AuthUser } from '@/types'
import { supabase } from '@/services/supabase'
import { getCurrentUser, signIn as authSignIn, signOut as authSignOut } from '@/services/auth'

interface AuthContextType {
  user: AuthUser | null
  loading: boolean
  profileError: string | null
  refreshProfile: () => Promise<void>
  signIn: (email: string, password: string) => Promise<{ error: string | null; user: AuthUser | null }>
  signOut: () => Promise<{ error: string | null }>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [profileError, setProfileError] = useState<string | null>(null)

  const loadUser = useCallback(async () => {
    const currentUser = await getCurrentUser()
    setUser(currentUser)
    if (currentUser && !currentUser.teacher) {
      setProfileError('Teacher profile not found. Contact your administrator.')
    } else {
      setProfileError(null)
    }
  }, [])

  const refreshProfile = useCallback(async () => {
    setProfileError(null)
    const currentUser = await getCurrentUser()
    setUser(currentUser)
    if (currentUser && !currentUser.teacher) {
      setProfileError('Teacher profile not found. Contact your administrator.')
    }
  }, [])

  useEffect(() => {
    const init = async () => {
      await loadUser()
      setLoading(false)
    }
    init()

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        await loadUser()
      } else {
        setUser(null)
      }
    })

    return () => listener?.subscription.unsubscribe()
  }, [loadUser])

  const signIn = async (email: string, password: string) => {
    const result = await authSignIn(email, password)
    if (result.user) {
      setUser(result.user)
      if (!result.user.teacher) {
        setProfileError('Teacher profile not found. Contact your administrator.')
      } else {
        setProfileError(null)
      }
    }
    return { error: result.error, user: result.user }
  }

  const signOut = async () => {
    const result = await authSignOut()
    if (!result.error) {
      setUser(null)
      setProfileError(null)
    }
    return result
  }

  return (
    <AuthContext.Provider value={{ user, loading, profileError, refreshProfile, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within an AuthProvider')
  return context
}
