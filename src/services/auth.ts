import { supabase } from './supabase'
import type { AuthUser, Teacher } from '@/types'

async function getTeacherProfile(userId: string): Promise<Teacher | null> {
  const { data, error } = await supabase
    .from('teachers')
    .select('*')
    .eq('id', userId)
    .single()

  if (error || !data) return null
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

  const teacher = await getTeacherProfile(authUser.id)

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
    redirectTo: `${window.location.origin}/login`,
  })
  return { error: error?.message ?? null }
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return null

  const teacher = await getTeacherProfile(data.user.id)
  return {
    id: data.user.id,
    email: data.user.email!,
    teacher,
    role: data.user.user_metadata?.role as string | undefined,
  }
}
