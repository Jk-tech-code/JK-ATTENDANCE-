import { supabase } from './supabase'
import type { AuthUser, Teacher } from '@/types'

async function getTeacherProfile(userId: string, email?: string): Promise<Teacher | null> {
  console.log('[Auth] Querying teacher profile for userId:', userId, 'email:', email)

  // Try user_id first (the proper link column)
  let { data, error } = await supabase
    .from('teachers')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()

  console.log('[Auth] Teacher query by user_id:', { data, error })

  if (!data && !error) {
    // Fall back to id column (legacy — teachers where id == auth.uid())
    const result = await supabase
      .from('teachers')
      .select('*')
      .eq('id', userId)
      .maybeSingle()

    console.log('[Auth] Teacher query by id fallback:', { data: result.data, error: result.error })
    data = result.data
    error = result.error
  }

  if (error) {
    console.error('[Auth] Failed to load teacher profile:', error.message)
    return null
  }
  if (!data) {
    console.warn('[Auth] No teacher record found for user:', userId)
    return null
  }
  return data as Teacher
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
