import { useAuth } from '@/contexts/AuthContext'
import { Card, CardContent } from '@/components/ui/card'
import { BadgeCheck, Building2, Hash } from 'lucide-react'

export function ProfileCard() {
  const { user } = useAuth()
  const teacher = user?.teacher

  if (!teacher) {
    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground">Profile not loaded</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
            {teacher.full_name
              .split(' ')
              .map((n) => n[0])
              .join('')
              .slice(0, 2)
              .toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{teacher.full_name}</p>
            <p className="text-xs text-muted-foreground">{teacher.email}</p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Hash className="h-3.5 w-3.5" />
            <span>{teacher.staff_number}</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Building2 className="h-3.5 w-3.5" />
            <span>{teacher.department ?? 'N/A'}</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <BadgeCheck className="h-3.5 w-3.5" />
            <span className="capitalize">{teacher.employment_status ?? 'active'}</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <span className="text-[10px]">🕐</span>
            <span>Report by {teacher.reporting_time?.slice(0, 5) ?? '07:20'}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
