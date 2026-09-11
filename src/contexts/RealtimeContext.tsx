import { useEffect, useRef, type ReactNode } from 'react'
import { supabase } from '@/services/supabase'
import { useQueryClient } from '@tanstack/react-query'

/**
 * RealtimeProvider subscribes to Postgres changes on key tables
 * and invalidates the relevant TanStack Query caches automatically,
 * so all open admin dashboards stay in sync without manual refetch.
 *
 * Invalidation is debounced (500ms) to batch rapid-fire events
 * (e.g. morning check-in spikes) into a single invalidation pass.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const pendingKeys = useRef<Set<string>>(new Set())
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scheduleFlush = () => {
    if (flushTimer.current) return
    flushTimer.current = setTimeout(() => {
      flushTimer.current = null
      const keys = pendingKeys.current
      pendingKeys.current = new Set()
      for (const key of keys) {
        queryClient.invalidateQueries({ queryKey: [key] })
      }
    }, 500)
  }

  const invalidate = (...keyPrefixes: string[]) => {
    for (const k of keyPrefixes) pendingKeys.current.add(k)
    scheduleFlush()
  }

  useEffect(() => {
    const channel = supabase
      .channel('admin-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teachers' }, () => {
        invalidate('teachers', 'dashboard')
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'attendance' }, () => {
        invalidate('dashboard', 'attendance-records', 'attendance')
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'attendance' }, () => {
        invalidate('dashboard', 'attendance-records', 'attendance')
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'school_calendar' }, () => {
        invalidate('calendar')
      })
      .subscribe()

    return () => {
      if (flushTimer.current) clearTimeout(flushTimer.current)
      supabase.removeChannel(channel)
    }
    // Only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <>{children}</>
}
