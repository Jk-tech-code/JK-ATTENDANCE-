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

  return useQuery({
    queryKey: attendanceKeys.today(teacherId ?? ''),
    queryFn: () => getTodayAttendance(teacherId!),
    enabled: !!teacherId,
    refetchInterval: 30000,
  })
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
