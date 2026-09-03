import { createContext } from 'react'
import type { AuthUser } from '@/types'

export interface AuthContextType {
  user: AuthUser | null
  loading: boolean
  profileError: string | null
  refreshProfile: () => Promise<void>
  signIn: (email: string, password: string) => Promise<{ error: string | null; user: AuthUser | null }>
  signOut: () => Promise<{ error: string | null }>
  signInWithGoogle: () => Promise<void>
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined)
