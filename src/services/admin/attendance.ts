import { supabase } from '@/services/supabase'
import type { Attendance } from '@/types'

export interface AttendanceFilters {
  date?: string
  status?: string
  teacher_id?: string
  page?: number
  page_size?: number
}

export interface AttendanceWithTeacher extends Attendance {
  teacher: {
    full_name: string
    staff_number: string
  } | null
}

export interface PaginatedAttendance {
  records: AttendanceWithTeacher[]
  total: number
  page: number
  page_size: number
}

export async function getAttendanceRecords(
  filters: AttendanceFilters = {}
): Promise<PaginatedAttendance> {
  const page = filters.page ?? 1
  const page_size = filters.page_size ?? 20
  const from = (page - 1) * page_size
  const to = from + page_size - 1

  let query = supabase.from('attendance').select('*, teacher:teachers(*)', { count: 'exact' })

  if (filters.date) query = query.eq('attendance_date', filters.date)
  if (filters.status) query = query.eq('status', filters.status)
  if (filters.teacher_id) query = query.eq('teacher_id', filters.teacher_id)

  const { data, error, count } = await query
    .order('attendance_date', { ascending: false })
    .order('check_in', { ascending: false })
    .range(from, to)

  if (error) throw new Error(error.message)
  return {
    records: (data ?? []) as unknown as AttendanceWithTeacher[],
    total: count ?? 0,
    page,
    page_size,
  }
}

// PostgREST's hard cap is 1000 rows per request; pass anything higher
// and it silently clamps to 1000. Anything that wants "all rows" must
// page. See https://postgrest.org/en/stable/references/api/pagination.html
export const POSTGREST_MAX_PAGE_SIZE = 1000

// Page through attendance records honouring the same filters as
// getAttendanceRecords, but fetching every row in chunks of
// POSTGREST_MAX_PAGE_SIZE. Used by full-export flows; the single-page
// UI keeps using getAttendanceRecords.
//
// `fetchPage` is injected so tests can drive the loop directly without
// having to stub the entire Supabase client.
export async function getAllAttendanceRecords(
  filters: Omit<AttendanceFilters, 'page' | 'page_size'> = {}
): Promise<AttendanceWithTeacher[]> {
  return pageAllAttendance(filters, getAttendanceRecords)
}

export async function pageAllAttendance(
  filters: Omit<AttendanceFilters, 'page' | 'page_size'>,
  fetchPage: (f: AttendanceFilters) => Promise<{ records: AttendanceWithTeacher[] }>
): Promise<AttendanceWithTeacher[]> {
  const all: AttendanceWithTeacher[] = []
  let page = 1
  for (;;) {
    const { records } = await fetchPage({
      ...filters,
      page,
      page_size: POSTGREST_MAX_PAGE_SIZE,
    })
    all.push(...records)
    if (records.length < POSTGREST_MAX_PAGE_SIZE) break
    page += 1
  }
  return all
}
