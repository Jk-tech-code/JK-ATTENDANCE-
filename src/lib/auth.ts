import type { AuthUser } from '@/types'

const ADMIN_ROLES = new Set(['admin', 'superadmin'])

export function isAdminRole(role: string | null | undefined): boolean {
  return ADMIN_ROLES.has(role?.toLowerCase() ?? '')
}

export function getAdminRole(user: AuthUser | null | undefined): string | null {
  if (!user) return null
  const role = user.role?.toLowerCase() ?? ''
  if (role === 'superadmin') return 'superadmin'
  if (role === 'admin') return 'admin'
  return null
}
