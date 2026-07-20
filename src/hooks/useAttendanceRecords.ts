import { useQuery } from '@tanstack/react-query'
import { getAttendanceRecords, getTeachers } from '@/services/admin'
import type { AttendanceFilters, AttendanceWithTeacher, PaginatedAttendance } from '@/services/admin'
import { useMemo } from 'react'

// ─── Query keys ──────────────────────────────────────────────
export const attendanceRecordsKeys = {
  all: ['attendance-records'] as const,
  list: (filters: AttendanceFilters) =>
    [...attendanceRecordsKeys.all, 'list', filters] as const,
  teachers: () => [...attendanceRecordsKeys.all, 'teachers'] as const,
}

// ─── Attendance records (paginated, filtered) ────────────────
export function useAttendanceRecords(filters: AttendanceFilters) {
  return useQuery({
    queryKey: attendanceRecordsKeys.list(filters),
    queryFn: () => getAttendanceRecords(filters),
    staleTime: 15_000,
    placeholderData: (previousData) => previousData,
  })
}

// ─── Teachers for the filter dropdown ────────────────────────
export function useAttendanceTeachers() {
  return useQuery({
    queryKey: attendanceRecordsKeys.teachers(),
    queryFn: () => getTeachers(),
    staleTime: 60_000,
  })
}

// ─── Aggregate hook ──────────────────────────────────────────
export interface UseAttendanceRecordsReturn {
  records: AttendanceWithTeacher[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  isLoading: boolean
  error: Error | null
}

export function useAttendanceRecordsWithFilters(filters: AttendanceFilters): UseAttendanceRecordsReturn {
  const recordsQuery = useAttendanceRecords(filters)

  return useMemo(() => {
    const paginated = recordsQuery.data as PaginatedAttendance | undefined
    const page = filters.page ?? 1
    const pageSize = filters.page_size ?? 20
    const total = paginated?.total ?? 0

    return {
      records: paginated?.records ?? [],
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      isLoading: recordsQuery.isLoading,
      error: recordsQuery.error as Error | null,
    }
  }, [recordsQuery.data, recordsQuery.isLoading, recordsQuery.error, filters.page, filters.page_size])
}
