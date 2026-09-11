import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getDashboardStats, getTeachers } from '@/services/admin'
import { getDailyReportEdge } from '@/services/attendanceApi'
import { todayEatClient } from '@/lib/format'
import type { DashboardStats } from '@/services/admin'
import type { DailyReport } from '@/services/attendanceApi'
import type { Teacher } from '@/types'

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

export function useAdminDashboard() {
  const today = todayEatClient()

  const statsQuery = useQuery({
    queryKey: dashboardKeys.stats(),
    queryFn: () => getDashboardStats(),
    staleTime: 30_000,
    gcTime: 120_000,
    refetchInterval: 120_000,
    retry: 2,
  })

  const dailyQuery = useQuery({
    queryKey: dashboardKeys.daily(today),
    queryFn: () => getDailyReportEdge(today),
    staleTime: 30_000,
    gcTime: 180_000,
    refetchInterval: 300_000,
    retry: 2,
  })

  const teachersQuery = useQuery({
    queryKey: dashboardKeys.teachers(),
    queryFn: () => getTeachers({ page: 1, pageSize: 100 }),
    staleTime: 60_000,
    gcTime: 300_000,
    refetchInterval: 300_000,
    retry: 2,
  })

  const isLoading = statsQuery.isLoading || dailyQuery.isLoading || teachersQuery.isLoading

  const errors = useMemo(() => {
    const e: Error[] = []
    if (statsQuery.error) e.push(statsQuery.error as Error)
    if (dailyQuery.error) e.push(dailyQuery.error as Error)
    if (teachersQuery.error) e.push(teachersQuery.error as Error)
    return e
  }, [statsQuery.error, dailyQuery.error, teachersQuery.error])

  const data = useMemo<AdminDashboardData>(
    () => ({
      stats: statsQuery.data ?? null,
      daily: dailyQuery.data ?? null,
      teachers: teachersQuery.data?.teachers ?? [],
    }),
    [statsQuery.data, dailyQuery.data, teachersQuery.data?.teachers]
  )

  return { data, isLoading, errors }
}
