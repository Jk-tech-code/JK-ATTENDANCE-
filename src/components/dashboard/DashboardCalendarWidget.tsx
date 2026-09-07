import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { checkDate, getCalendarEntries } from '@/services/calendar'
import type { DateCheckResult, SchoolCalendarEntry } from '@/services/calendar'
import { CalendarDays, Sun, Moon, CloudSun, AlertCircle } from 'lucide-react'
import { format } from 'date-fns'

export function DashboardCalendarWidget() {
  const [dateInfo, setDateInfo] = useState<DateCheckResult | null>(null)
  const [nextEvent, setNextEvent] = useState<SchoolCalendarEntry | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const today = format(new Date(), 'yyyy-MM-dd')
    const todayObj = new Date()
    const endOfMonth = new Date(todayObj.getFullYear(), todayObj.getMonth() + 2, 0)
    const endDate = format(endOfMonth, 'yyyy-MM-dd')

    let cancelled = false

    async function load() {
      const safe = async <T,>(p: Promise<T>): Promise<T | null> => {
        try {
          return await p
        } catch (err) {
          console.error('[DashboardCalendarWidget] sub-query failed:', err)
          return null
        }
      }

      const [date, entries] = await Promise.all([
        safe(checkDate(today)),
        safe(getCalendarEntries(today, endDate)),
      ])

      if (cancelled) return

      if (!date) {
        setError('Unable to load calendar info')
      } else {
        setDateInfo(date)
      }

      if (entries) {
        const upcoming = entries
          .filter(
            (e) => e.calendar_date > today && (e.day_type === 'holiday' || e.day_type === 'event')
          )
          .sort((a, b) => a.calendar_date.localeCompare(b.calendar_date))
        if (upcoming.length > 0) setNextEvent(upcoming[0])
      }

      setLoading(false)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-4 w-40" />
        </CardContent>
      </Card>
    )
  }

  const today = format(new Date(), 'EEEE, dd MMMM yyyy')

  if (error) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 p-4 text-center">
          <AlertCircle className="h-5 w-5 text-muted-foreground" />
          <p className="text-sm font-medium">Calendar unavailable</p>
          <p className="text-xs text-muted-foreground">{error}</p>
          <Button variant="ghost" size="sm" onClick={() => window.location.reload()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    )
  }

  const dateInfoSafe = dateInfo
  if (!dateInfoSafe) return null

  const isWeekend = dateInfoSafe.is_weekend
  const isHoliday = dateInfoSafe.is_holiday

  return (
    <Card className="overflow-hidden">
      <CardHeader
        className={`pb-3 ${
          isHoliday
            ? 'bg-yellow-50 dark:bg-yellow-950/20'
            : isWeekend
              ? 'bg-blue-50 dark:bg-blue-950/20'
              : 'bg-green-50 dark:bg-green-950/20'
        }`}
      >
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <CalendarDays className="h-4 w-4" />
              Today
            </CardTitle>
            <p className="text-lg font-bold mt-1">{today}</p>
          </div>
          {isHoliday ? (
            <Sun className="h-6 w-6 text-yellow-500" />
          ) : isWeekend ? (
            <Moon className="h-6 w-6 text-blue-500" />
          ) : (
            <CloudSun className="h-6 w-6 text-green-500" />
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-4 space-y-3">
        <div className="rounded-lg border p-3">
          <div className="flex items-center gap-2 text-sm">
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                isHoliday
                  ? 'bg-yellow-100 text-yellow-700'
                  : isWeekend
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-green-100 text-green-700'
              }`}
            >
              {dateInfoSafe.title || 'Working Day'}
            </span>
            <span className="text-muted-foreground">
              {!dateInfoSafe.attendance_allowed ? 'Attendance not required' : 'Attendance active'}
            </span>
          </div>
        </div>

        {nextEvent &&
          (() => {
            const raw = nextEvent.calendar_date
            const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T12:00:00`) : null
            const dateLabel =
              parsed && !Number.isNaN(parsed.getTime())
                ? parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                : 'TBD'
            return (
              <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>
                    Next: {nextEvent.title} - {dateLabel}
                  </span>
                </div>
              </div>
            )
          })()}
      </CardContent>
    </Card>
  )
}
