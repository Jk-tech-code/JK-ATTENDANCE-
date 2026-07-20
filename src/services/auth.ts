import { supabase } from './supabase'
import type { AuthUser, Teacher } from '@/types'

async function getTeacherProfile(userId: string, email?: string): Promise<Teacher | null> {
  console.log('[Auth] Querying teacher profile for userId:', userId, 'email:', email)

  for (const field of ['auth_user_id', 'user_id', 'id'] as const) {
    const { data, error } = await supabase
      .from('teachers')
      .select('*')
      .eq(field, userId)
      .maybeSingle()

    console.log(`[Auth] Teacher query by ${field}:`, { data, error })

    if (data) return data as Teacher
    if (error) {
      console.error(`[Auth] Error querying by ${field}:`, error.message)
      return null
    }
  }

  console.warn('[Auth] No teacher record found for user:', userId)
  return null
}

export async function signIn(
  email: string,
  password: string
): Promise<{ user: AuthUser | null; error: string | null }> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) return { user: null, error: error.message }

  const authUser = data.user
  if (!authUser) return { user: null, error: 'No user returned' }

  const teacher = await getTeacherProfile(authUser.id, authUser.email ?? undefined)

  return {
    user: {
      id: authUser.id,
      email: authUser.email!,
      teacher,
      role: authUser.user_metadata?.role as string | undefined,
    },
    error: null,
  }
}

export async function signOut(): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signOut()
  return { error: error?.message ?? null }
}

export async function resetPassword(
  email: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  })
  return { error: error?.message ?? null }
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const { data, error } = await supabase.auth.getUser()
  console.log('[Auth] getCurrentUser:', { data, error })
  if (error || !data.user) return null

  const teacher = await getTeacherProfile(data.user.id, data.user.email ?? undefined)
  console.log('[Auth] Current user result:', {
    id: data.user.id,
    email: data.user.email,
    hasTeacher: !!teacher,
    role: data.user.user_metadata?.role,
  })
  return {
    id: data.user.id,
    email: data.user.email!,
    teacher,
    role: data.user.user_metadata?.role as string | undefined,
  }
}
