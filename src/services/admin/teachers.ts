import { supabase } from '@/services/supabase'
import type { Teacher } from '@/types'

// ─── Teachers CRUD ───────────────────────────────────────────
export interface GetTeachersParams {
  page?: number
  pageSize?: number
  search?: string
  employmentStatus?: string
}

export interface PaginatedTeachers {
  teachers: Teacher[]
  total: number
  page: number
  pageSize: number
}

export async function getTeachers(params: GetTeachersParams = {}): Promise<PaginatedTeachers> {
  const page = params.page ?? 1
  const pageSize = params.pageSize ?? 20
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let query = supabase
    .from('teachers')
    .select('*', { count: 'exact' })
    .order('full_name', { ascending: true })

  if (params.search) {
    // Sanitize search input before injecting into PostgREST filter strings.
    // PostgREST parses commas / parens as operator separators inside .or(),
    // so unsanitized input can break the filter or broaden it unexpectedly.
    const safe = params.search.replace(/[\\%_(),]/g, (c) => '\\' + c)
    const pattern = `%${safe}%`
    query = query.or(
      `full_name.ilike.${pattern},staff_number.ilike.${pattern},email.ilike.${pattern}`
    )
  }
  if (params.employmentStatus) {
    query = query.eq('employment_status', params.employmentStatus)
  }

  const { data, error, count } = await query.range(from, to)

  if (error) throw new Error(error.message)
  return { teachers: (data ?? []) as Teacher[], total: count ?? 0, page, pageSize }
}

// Legacy function for backward compatibility - fetches all (use with caution)
export async function getAllTeachers(): Promise<Teacher[]> {
  const { data, error } = await supabase
    .from('teachers')
    .select('*')
    .order('full_name', { ascending: true })

  if (error) throw new Error(error.message)
  return data as Teacher[]
}

export interface CreateTeacherInput {
  staff_number: string
  full_name: string
  email: string
  department?: string
  phone?: string
  reporting_time?: string
  employment_status?: string
}

export async function createTeacher(input: CreateTeacherInput): Promise<Teacher> {
  return callInviteEdgeFunction(input)
}

export async function updateTeacher(
  id: string,
  input: Partial<{
    staff_number: string
    full_name: string
    email: string
    department: string | null
    phone: string | null
    reporting_time: string | null
    employment_status: string
  }>
): Promise<Teacher> {
  const { data, error } = await supabase
    .from('teachers')
    .update(input)
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as Teacher
}

export async function deleteTeacher(id: string): Promise<void> {
  const { data: session } = await supabase.auth.getSession()
  const token = session?.session?.access_token
  if (!token) throw new Error('Not authenticated')

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const url = `${supabaseUrl}/functions/v1/delete-teacher`
  console.log('[deleteTeacher] Calling:', url, { teacher_id: id })

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ teacher_id: id }),
    })
  } catch {
    throw new Error('Cannot reach server. Check your internet connection.')
  }

  const body = await res.json()
  if (!res.ok || !body.success) {
    throw new Error(body?.error ?? 'Failed to delete teacher')
  }
}

export async function inviteTeacher(input: {
  staff_number: string
  full_name: string
  email: string
  department?: string
  phone?: string
  reporting_time?: string
}): Promise<{ teacher: Teacher }> {
  const teacher = await callInviteEdgeFunction(input)
  return { teacher }
}

// ─── Shared edge function caller ─────────────────────────────
async function callInviteEdgeFunction(input: {
  staff_number: string
  full_name: string
  email: string
  department?: string
  phone?: string
  reporting_time?: string
}): Promise<Teacher> {
  const { data: session } = await supabase.auth.getSession()
  const token = session?.session?.access_token
  if (!token) throw new Error('Not authenticated')

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const url = `${supabaseUrl}/functions/v1/invite-teacher`
  console.log('[inviteTeacher] Calling:', url, { email: input.email })

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    })
  } catch (fetchErr) {
    console.error('[inviteTeacher] Fetch failed:', fetchErr)
    throw new Error(
      (fetchErr as Error)?.message?.includes('fetch') ||
        (fetchErr as Error)?.message?.includes('network')
        ? 'Cannot reach server. Check your internet connection.'
        : (fetchErr as Error).message
    )
  }

  let body: { teacher?: Teacher; error?: string }
  try {
    body = await res.json()
  } catch {
    throw new Error(`Server returned ${res.status} with no JSON body`)
  }

  if (!res.ok) {
    throw new Error(body?.error ?? `Request failed (${res.status})`)
  }

  if (!body.teacher) {
    throw new Error('Server response missing teacher record')
  }

  return body.teacher
}
