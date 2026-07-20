import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getCalendarEntries,
  createCalendarEntry,
  updateCalendarEntry,
  deleteCalendarEntry,
} from '@/services/calendar'
import type { SchoolCalendarEntry } from '@/services/calendar'

// ─── Query keys ──────────────────────────────────────────────
export const calendarKeys = {
  all: ['calendar'] as const,
  list: (startDate: string, endDate: string) =>
    [...calendarKeys.all, 'list', startDate, endDate] as const,
}

// ─── Read ────────────────────────────────────────────────────
export function useCalendarEntries(startDate: string, endDate: string) {
  return useQuery({
    queryKey: calendarKeys.list(startDate, endDate),
    queryFn: () => getCalendarEntries(startDate, endDate),
    staleTime: 30_000,
    enabled: !!startDate && !!endDate,
  })
}

// ─── Create ──────────────────────────────────────────────────
export function useCreateCalendarEntry() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: Parameters<typeof createCalendarEntry>[0]) =>
      createCalendarEntry(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: calendarKeys.all })
    },
  })
}

// ─── Update ──────────────────────────────────────────────────
export function useUpdateCalendarEntry() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string
      input: Parameters<typeof updateCalendarEntry>[1]
    }) => updateCalendarEntry(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: calendarKeys.all })
    },
  })
}

// ─── Delete ──────────────────────────────────────────────────
export function useDeleteCalendarEntry() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => deleteCalendarEntry(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: calendarKeys.all })
    },
  })
}
