import type { AuthUser } from '@/types'

const ADMIN_ROLES = new Set(['admin', 'superadmin'])

function isRoleAdmin(role: string | null | undefined): boolean {
  return ADMIN_ROLES.has(role?.toLowerCase() ?? '')
}

export function isAdminRole(input: string | null | undefined | AuthUser): boolean {
  if (typeof input === 'object' && input !== null && 'id' in input) {
    const user = input as AuthUser
    if (isRoleAdmin(user.role)) return true
    if (isRoleAdmin(user.teacher?.role)) return true
    return false
  }
  return isRoleAdmin(input as string | null | undefined)
}

export function getAdminRole(user: AuthUser | null | undefined): string | null {
  if (!user) return null
  const role = user.role?.toLowerCase() ?? ''
  if (role === 'superadmin') return 'superadmin'
  if (role === 'admin') return 'admin'
  const teacherRole = user.teacher?.role?.toLowerCase() ?? ''
  if (teacherRole === 'superadmin') return 'superadmin'
  if (teacherRole === 'admin') return 'admin'
  return null
}
