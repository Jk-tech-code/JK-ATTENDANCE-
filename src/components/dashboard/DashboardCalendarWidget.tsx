import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { checkDate, getCalendarEntries } from '@/services/calendar'
import { getDashboardStats } from '@/services/admin'
import type { DateCheckResult, SchoolCalendarEntry } from '@/services/calendar'
import type { DashboardStats } from '@/services/admin'
import { CalendarDays, Sun, Moon, CloudSun, ArrowRight } from 'lucide-react'
import { format } from 'date-fns'
import { useNavigate } from 'react-router-dom'

export function DashboardCalendarWidget() {
  const navigate = useNavigate()
  const [dateInfo, setDateInfo] = useState<DateCheckResult | null>(null)
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [nextEvent, setNextEvent] = useState<SchoolCalendarEntry | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const today = format(new Date(), 'yyyy-MM-dd')
    const todayObj = new Date()
    const endOfMonth = new Date(todayObj.getFullYear(), todayObj.getMonth() + 2, 0)
    const endDate = format(endOfMonth, 'yyyy-MM-dd')

    Promise.all([
      checkDate(today),
      getDashboardStats(),
      getCalendarEntries(today, endDate),
    ])
      .then(([date, statsData, entries]) => {
        setDateInfo(date)
        setStats(statsData)

        const upcoming = entries
          .filter(e => e.calendar_date > today && (e.day_type === 'holiday' || e.day_type === 'event'))
          .sort((a, b) => a.calendar_date.localeCompare(b.calendar_date))

        if (upcoming.length > 0) setNextEvent(upcoming[0])
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <Card>
        <CardHeader><Skeleton className="h-5 w-32" /></CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-4 w-40" />
        </CardContent>
      </Card>
    )
  }

  const today = format(new Date(), 'EEEE, dd MMMM yyyy')
  const isWeekend = dateInfo?.is_weekend
  const isHoliday = dateInfo?.is_holiday

  return (
    <Card className="overflow-hidden">
      <CardHeader className={`pb-3 ${
        isHoliday ? 'bg-yellow-50 dark:bg-yellow-950/20' :
        isWeekend ? 'bg-blue-50 dark:bg-blue-950/20' :
        'bg-green-50 dark:bg-green-950/20'
      }`}>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <CalendarDays className="h-4 w-4" />
              Today
            </CardTitle>
            <p className="text-lg font-bold mt-1">{today}</p>
          </div>
          {isHoliday ? <Sun className="h-6 w-6 text-yellow-500" /> :
           isWeekend ? <Moon className="h-6 w-6 text-blue-500" /> :
           <CloudSun className="h-6 w-6 text-green-500" />}
        </div>
      </CardHeader>
      <CardContent className="pt-4 space-y-3">
        <div className="rounded-lg border p-3">
          <div className="flex items-center gap-2 text-sm">
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
              isHoliday ? 'bg-yellow-100 text-yellow-700' :
              isWeekend ? 'bg-blue-100 text-blue-700' :
              'bg-green-100 text-green-700'
            }`}>
              {dateInfo?.title ?? 'Working Day'}
            </span>
            <span className="text-muted-foreground">
              {!dateInfo?.attendance_allowed ? 'Attendance not required' : 'Attendance active'}
            </span>
          </div>
        </div>

        {dateInfo?.attendance_allowed && stats && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Attendance</span>
            <span className="font-medium">
              {stats.present_today + stats.late_today}/{stats.total_teachers} Teachers Present
            </span>
          </div>
        )}

        {nextEvent && (
          <button
            onClick={() => navigate('/admin/holidays')}
            className="flex w-full items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm hover:bg-accent/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
              <span>
                <span className="font-medium">Upcoming:</span>{' '}
                {nextEvent.title} - {new Date(nextEvent.calendar_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        )}
      </CardContent>
    </Card>
  )
}
