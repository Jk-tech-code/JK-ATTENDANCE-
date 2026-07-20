import { useEffect, type ReactNode } from 'react'
import { supabase } from '@/services/supabase'
import { useQueryClient } from '@tanstack/react-query'

/**
 * RealtimeProvider subscribes to Postgres changes on key tables
 * and invalidates the relevant TanStack Query caches automatically,
 * so all open admin dashboards stay in sync without manual refetch.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()

  useEffect(() => {
    // Subscribe to all changes on the teachers table
    const channel = supabase
      .channel('admin-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'teachers' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['teachers'] })
          queryClient.invalidateQueries({ queryKey: ['dashboard'] })
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'attendance' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['dashboard'] })
          queryClient.invalidateQueries({ queryKey: ['attendance-records'] })
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'school_calendar' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['calendar'] })
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
    // Only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <>{children}</>
}
