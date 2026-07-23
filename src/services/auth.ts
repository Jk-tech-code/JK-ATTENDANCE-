import { supabase } from './supabase'
import type { AuthUser, Teacher, Profile } from '@/types'

async function getTeacherProfile(userId: string, email?: string): Promise<Teacher | null> {
  let lastError: string | null = null

  for (const field of ['auth_user_id', 'user_id', 'id'] as const) {
    const { data, error } = await supabase
      .from('teachers')
      .select('*')
      .eq(field, userId)
      .maybeSingle()

    if (data) return data as Teacher
    if (error) {
      lastError = `Query by ${field}=${userId} failed: ${error.message}`
      console.error(`[getTeacherProfile] ${lastError}`)
    }
  }

  if (email) {
    const { data, error } = await supabase
      .from('teachers')
      .select('*')
      .eq('email', email)
      .maybeSingle()
    if (data) return data as Teacher
    if (error) {
      lastError = `Query by email=${email} failed: ${error.message}`
      console.error(`[getTeacherProfile] ${lastError}`)
    }
  }

  if (lastError) {
    console.warn(`[getTeacherProfile] All lookups failed. Last error: ${lastError}`)
  }

  return null
}

async function getOrCreateProfile(userId: string, email?: string): Promise<Profile | null> {
  const { data: existing } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()

  if (existing) return existing as Profile

  if (!email) return null

  const { data: created, error } = await supabase
    .from('profiles')
    .insert({ id: userId, email })
    .select()
    .maybeSingle()

  if (error) {
    console.error('[getOrCreateProfile] Failed to create profile:', error.message)
    return null
  }

  return created as Profile
}

export async function signInWithGoogle(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/login`,
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
    },
  })

  if (error) {
    throw new Error(error.message)
  }
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

  if (teacher) {
    return {
      user: {
        id: authUser.id,
        email: authUser.email!,
        teacher,
        profile: null,
        role: teacher.role ?? 'teacher',
      },
      error: null,
    }
  }

  const profile = await getOrCreateProfile(authUser.id, authUser.email ?? undefined)

  return {
    user: {
      id: authUser.id,
      email: authUser.email!,
      teacher: null,
      profile,
      role: profile?.role ?? 'teacher',
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
  if (error || !data.user) return null

  const teacher = await getTeacherProfile(data.user.id, data.user.email ?? undefined)

  if (teacher) {
    return {
      id: data.user.id,
      email: data.user.email!,
      teacher,
      profile: null,
      role: teacher.role ?? 'teacher',
    }
  }

  const profile = await getOrCreateProfile(data.user.id, data.user.email ?? undefined)

  return {
    id: data.user.id,
    email: data.user.email!,
    teacher: null,
    profile,
    role: profile?.role ?? 'teacher',
  }
}
