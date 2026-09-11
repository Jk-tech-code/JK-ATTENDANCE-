import { supabase } from '@/services/supabase'

export interface AdminUser {
  id: string
  email: string
  full_name: string
  role: 'admin' | 'superadmin'
  created_at: string
  invitation_sent: boolean
}

export interface CreateAdminInput {
  email: string
  full_name: string
  role: 'admin' | 'superadmin'
}

/**
 * Fetch all admin and superadmin accounts.
 * Queries the teachers table for role IN ('admin', 'superadmin').
 */
export async function getAdminUsers(): Promise<AdminUser[]> {
  const { data, error } = await supabase
    .from('teachers')
    .select('id, email, full_name, role, created_at, invitation_sent')
    .in('role', ['admin', 'superadmin'])
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return (data ?? []) as AdminUser[]
}

/**
 * Create a new admin or superadmin account via the Edge Function.
 * The Edge Function handles auth user creation, teacher record creation,
 * profile update, and server-side authorization checks.
 */
export interface CreateAdminResult {
  admin: {
    id: string
    email: string
    full_name: string
    role: string
    temp_password?: string
  }
}

export async function createAdminAccount(input: CreateAdminInput): Promise<CreateAdminResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session?.access_token) {
    throw new Error('Not authenticated')
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const response = await fetch(`${supabaseUrl}/functions/v1/create-admin`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })

  const body = await response.json()

  if (!response.ok) {
    throw new Error(body.error || 'Failed to create administrator account')
  }

  return body
}
