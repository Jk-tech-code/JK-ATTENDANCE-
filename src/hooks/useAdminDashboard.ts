import { useQuery } from '@tanstack/react-query'
import { getDashboardStats, getTeachers } from '@/services/admin'
import { getDailyReportEdge } from '@/services/attendanceApi'
import { format } from 'date-fns'
import type { DashboardStats } from '@/services/admin'
import type { DailyReport } from '@/services/attendanceApi'
import type { Teacher } from '@/types'

// ─── Query keys ──────────────────────────────────────────────
export const dashboardKeys = {
  all: ['dashboard'] as const,
  stats: () => [...dashboardKeys.all, 'stats'] as const,
  daily: (date: string) => [...dashboardKeys.all, 'daily', date] as const,
  teachers: () => [...dashboardKeys.all, 'teachers'] as const,
}

export interface AdminDashboardData {
  stats: DashboardStats | null
  daily: DailyReport | null
  teachers: Teacher[]
}

// ─── Query ───────────────────────────────────────────────────
export function useAdminDashboard() {
  const today = format(new Date(), 'yyyy-MM-dd')

  const statsQuery = useQuery({
    queryKey: dashboardKeys.stats(),
    queryFn: () => getDashboardStats(),
    staleTime: 15_000,
    gcTime: 120_000,
    refetchInterval: 30_000,
  })

  const dailyQuery = useQuery({
    queryKey: dashboardKeys.daily(today),
    queryFn: () => getDailyReportEdge(today),
    staleTime: 15_000,
    gcTime: 180_000,
    refetchInterval: 60_000,
  })

  const teachersQuery = useQuery({
    queryKey: dashboardKeys.teachers(),
    queryFn: () => getTeachers(),
    staleTime: 30_000,
    gcTime: 300_000,
    refetchInterval: 60_000,
  })

  const isLoading = statsQuery.isLoading || dailyQuery.isLoading || teachersQuery.isLoading
  const error = statsQuery.error ?? dailyQuery.error ?? teachersQuery.error ?? null

  return {
    data: {
      stats: statsQuery.data ?? null,
      daily: dailyQuery.data ?? null,
      teachers: teachersQuery.data ?? [],
    } satisfies AdminDashboardData,
    isLoading,
    error: error as Error | null,
  }
}
