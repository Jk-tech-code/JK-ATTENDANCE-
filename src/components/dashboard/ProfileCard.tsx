import { useAuth } from '@/hooks/useAuth'
import { Card, CardContent } from '@/components/ui/card'
import { BadgeCheck, Building2, Hash, RefreshCw, AlertCircle, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

export function ProfileCard() {
  const { user, loading, profileError, refreshProfile } = useAuth()
  const teacher = user?.teacher

  if (loading) {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-40" />
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-20" />
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!teacher) {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col items-center gap-2 text-center">
            <AlertCircle className="h-6 w-6 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Profile not loaded</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {profileError || 'Could not load your profile'}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={refreshProfile}>
              <RefreshCw className="mr-1 h-3 w-3" /> Retry
            </Button>
          </div>
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
            <Clock className="h-3.5 w-3.5" />
            <span>Report by {teacher.reporting_time?.slice(0, 5) ?? '07:20'}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
