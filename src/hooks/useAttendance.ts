import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import {
  getTodayAttendance,
  checkOut as checkOutService,
  undoCheckOut as undoCheckOutService,
  getAttendanceSummary,
} from '@/services/attendance'

const attendanceKeys = {
  today: (teacherId: string) => ['attendance', 'today', teacherId] as const,
  summary: (teacherId: string, year: number, month: number) =>
    ['attendance', 'summary', teacherId, year, month] as const,
}

export function useTodayAttendance() {
  const { user } = useAuth()
  const teacherId = user?.teacher?.id
  const attendance = useQuery({
    queryKey: attendanceKeys.today(teacherId ?? ''),
    queryFn: () => getTodayAttendance(teacherId!),
    enabled: !!teacherId,
    // FIX M7: Optimize refetch strategy
    // - Refetch on window focus (when user returns to tab)
    // - Refetch every 5 minutes (300s) instead of 30s - less aggressive polling
    // - Don't refetch in background if not checked in (stale data is fine)
    refetchInterval: (query) => {
      // If checked in, refetch every 2 minutes to show real-time status
      // If not checked in, refetch every 5 minutes (just for date changes)
      return query.state.data?.check_in ? 120000 : 300000
    },
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    staleTime: 60000, // Consider data fresh for 1 minute
  })
  return attendance
}

export function useCheckOut() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: (attendanceId: string) => checkOutService(attendanceId),
    onSuccess: () => {
      const teacherId = user?.teacher?.id
      if (!teacherId) return
      queryClient.invalidateQueries({ queryKey: attendanceKeys.today(teacherId) })
      const now = new Date()
      queryClient.invalidateQueries({
        queryKey: attendanceKeys.summary(teacherId, now.getFullYear(), now.getMonth() + 1),
      })
    },
  })
}

export function useUndoCheckOut() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: (attendanceId: string) => undoCheckOutService(attendanceId),
    onSuccess: () => {
      const teacherId = user?.teacher?.id
      if (!teacherId) return
      queryClient.invalidateQueries({ queryKey: attendanceKeys.today(teacherId) })
      const now = new Date()
      queryClient.invalidateQueries({
        queryKey: attendanceKeys.summary(teacherId, now.getFullYear(), now.getMonth() + 1),
      })
    },
  })
}

export function useAttendanceSummary() {
  const { user } = useAuth()
  const teacherId = user?.teacher?.id
  const now = new Date()

  return useQuery({
    queryKey: attendanceKeys.summary(teacherId ?? '', now.getFullYear(), now.getMonth() + 1),
    queryFn: () => getAttendanceSummary(teacherId!, now.getFullYear(), now.getMonth() + 1),
    enabled: !!teacherId,
  })
}
