import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import type { AuthUser } from '@/types'
import { supabase } from '@/services/supabase'
import { getCurrentUser, signIn as authSignIn, signOut as authSignOut } from '@/services/auth'

interface AuthContextType {
  user: AuthUser | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<{ error: string | null }>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const init = async () => {
      const currentUser = await getCurrentUser()
      setUser(currentUser)
      setLoading(false)
    }
    init()

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        const currentUser = await getCurrentUser()
        setUser(currentUser)
      } else {
        setUser(null)
      }
    })

    return () => listener?.subscription.unsubscribe()
  }, [])

  const signIn = async (email: string, password: string) => {
    const result = await authSignIn(email, password)
    if (result.user) setUser(result.user)
    return { error: result.error }
  }

  const signOut = async () => {
    const result = await authSignOut()
    if (!result.error) setUser(null)
    return result
  }

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within an AuthProvider')
  return context
}
