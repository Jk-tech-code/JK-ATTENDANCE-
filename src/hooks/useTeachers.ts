import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getTeachers,
  createTeacher,
  updateTeacher,
  deleteTeacher,
  inviteTeacher,
} from '@/services/admin'

// ─── Query keys ──────────────────────────────────────────────
export const teacherKeys = {
  all: ['teachers'] as const,
  list: () => [...teacherKeys.all, 'list'] as const,
}

// ─── Read ────────────────────────────────────────────────────
export function useTeachers() {
  return useQuery({
    queryKey: teacherKeys.list(),
    queryFn: getTeachers,
    staleTime: 30_000,
  })
}

// ─── Create ──────────────────────────────────────────────────
export function useCreateTeacher() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: Parameters<typeof createTeacher>[0]) => createTeacher(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: teacherKeys.all })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

// ─── Update ──────────────────────────────────────────────────
export function useUpdateTeacher() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof updateTeacher>[1] }) =>
      updateTeacher(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: teacherKeys.all })
    },
  })
}

// ─── Delete ──────────────────────────────────────────────────
export function useDeleteTeacher() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => deleteTeacher(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: teacherKeys.all })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

// ─── Invite ──────────────────────────────────────────────────
export function useInviteTeacher() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: Parameters<typeof inviteTeacher>[0]) => inviteTeacher(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: teacherKeys.all })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}
