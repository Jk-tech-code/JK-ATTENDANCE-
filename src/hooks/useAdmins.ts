import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getAdminUsers, createAdminAccount } from '@/services/admin/admins'
import type { CreateAdminInput } from '@/services/admin/admins'

export const adminKeys = {
  all: ['admins'] as const,
  list: () => [...adminKeys.all, 'list'] as const,
}

/**
 * Fetch all admin/superadmin accounts.
 */
export function useAdminUsers() {
  return useQuery({
    queryKey: adminKeys.list(),
    queryFn: getAdminUsers,
    staleTime: 30_000,
  })
}

/**
 * Create a new admin or superadmin account.
 * Invalidates the admin list on success.
 */
export function useCreateAdmin() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateAdminInput) => createAdminAccount(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.all })
    },
  })
}
