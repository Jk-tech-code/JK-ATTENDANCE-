import { useQuery, useMutation } from '@tanstack/react-query'
import { getDailyReportEdge, getMonthlyReportEdge, getAttendanceAnalytics } from '@/services/attendanceApi'

// ─── Query keys ──────────────────────────────────────────────
export const reportKeys = {
  all: ['reports'] as const,
  daily: (date: string) => [...reportKeys.all, 'daily', date] as const,
  monthly: (year: number, month: number) =>
    [...reportKeys.all, 'monthly', year, month] as const,
}

// ─── Daily report ────────────────────────────────────────────
export function useDailyReport(date: string) {
  return useQuery({
    queryKey: reportKeys.daily(date),
    queryFn: () => getDailyReportEdge(date),
    staleTime: 30_000,
    gcTime: 300_000,
    enabled: !!date,
  })
}

// ─── Monthly report ──────────────────────────────────────────
export function useMonthlyReport(year: number, month: number) {
  return useQuery({
    queryKey: reportKeys.monthly(year, month),
    queryFn: () => getMonthlyReportEdge(year, month),
    staleTime: 30_000,
    gcTime: 300_000,
  })
}

// ─── AI Analysis (manually triggered) ────────────────────────
export function useAiAnalysis() {
  return useMutation({
    mutationFn: (options: { year: number; month: number }) =>
      getAttendanceAnalytics(options),
  })
}
