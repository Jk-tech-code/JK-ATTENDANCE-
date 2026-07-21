import { useEffect, useState, useMemo } from 'react'
import { Helmet } from 'react-helmet-async'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { getMonthCalendar, getDayAttendanceDetail, generateMonthlyReport } from '@/services/calendar'
import type { MonthCalendar, DayAttendance } from '@/services/calendar'
import {
  ChevronLeft, ChevronRight, CalendarDays,
  CheckCircle2, XCircle,
  Clock, Download,
} from 'lucide-react'
import { toast } from 'sonner'
import { format } from 'date-fns'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const currentYear = new Date().getFullYear()
const years = Array.from({ length: 10 }, (_, i) => currentYear - 3 + i)

function getDayColor(day: MonthCalendar['calendar'][0]): string {
  if (!day || !day.day_type) return 'bg-card border-border'
  const dt = day.day_type
  if (dt === 'weekend') return 'bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800'
  if (dt === 'holiday' || dt === 'event') return 'bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-800'
  if (dt === 'working_day') {
    if ((day.present ?? 0) > 0) return 'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800'
    if ((day.absent ?? 0) > 0 && !day.present && !day.late) return 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800'
  }
  return 'bg-card border-border'
}

export default function CalendarPage() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [data, setData] = useState<MonthCalendar | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [dayDetail, setDayDetail] = useState<DayAttendance | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    setLoading(true)
    getMonthCalendar(year, month)
      .then(setData)
      .catch(() => toast.error('Failed to load calendar'))
      .finally(() => setLoading(false))
  }, [year, month])

  const calendarGrid = useMemo(() => {
    if (!data) return []
    const firstDay = new Date(year, month - 1, 1).getDay()
    const weeks: (MonthCalendar['calendar'][0] | null)[][] = []
    let week: (MonthCalendar['calendar'][0] | null)[] = []

    for (let i = 0; i < firstDay; i++) week.push(null)

    for (const day of data.calendar) {
      week.push(day)
      if (week.length === 7) {
        weeks.push(week)
        week = []
      }
    }

    while (week.length < 7) {
      week.push(null)
    }
    if (week.length > 0) weeks.push(week)

    return weeks
  }, [data, year, month])

  const navigate = (delta: number) => {
    let m = month + delta
    let y = year
    if (m < 1) { m = 12; y-- }
    if (m > 12) { m = 1; y++ }
    setMonth(m)
    setYear(y)
    setSelectedDate(null)
    setDayDetail(null)
  }

  const handleDateClick = async (date: string) => {
    if (new Date(date) > new Date()) {
      toast.info('Future date - no attendance data available')
      return
    }
    setSelectedDate(date)
    setDetailLoading(true)
    try {
      const detail = await getDayAttendanceDetail(date)
      setDayDetail(detail)
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setDetailLoading(false)
    }
  }

  const handleGenerateReport = async () => {
    setGenerating(true)
    try {
      const report = await generateMonthlyReport(year, month)
      const filename = `monthly_report_${year}_${month}`
      const csvRows = report.working_days.map(d =>
        `${d.date},${d.present},${d.late},${d.absent},${d.total}`
      )
      const csv = [
        `Monthly Report - ${MONTHS[month - 1]} ${year}`,
        `Total Teachers,${report.total_teachers}`,
        `Working Days,${report.total_working_days}`,
        `Attendance Rate,${report.attendance_rate}%`,
        `Total Present,${report.total_present}`,
        `Total Late,${report.total_late}`,
        `Total Absent,${report.total_absent}`,
        '',
        'Date,Present,Late,Absent,Total',
        ...csvRows,
      ].join('\n')

      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${filename}.csv`
      a.click()
      URL.revokeObjectURL(url)

      toast.success('Monthly report generated')
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setGenerating(false)
    }
  }

  const today = format(now, 'yyyy-MM-dd')
  const workingDays = data?.calendar.filter(d => d.day_type === 'working_day') ?? []
  const totalWorking = workingDays.length
  const completedDays = workingDays.filter(d => d.present > 0 || d.late > 0).length

  return (
    <>
      <Helmet>
        <title>Calendar — Admin | JK Attendance System</title>
        <meta name="description" content="Monthly attendance calendar overview" />
        <meta name="robots" content="noindex, follow" />
      </Helmet>
      <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Attendance Calendar</h1>
        <Button variant="outline" size="sm" onClick={handleGenerateReport} loading={generating}>
          <Download className="mr-2 h-4 w-4" />Generate Monthly Report
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Month</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{MONTHS[month - 1]} {year}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Working Days</CardTitle></CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totalWorking}</p>
            <p className="text-xs text-muted-foreground">{completedDays}/{totalWorking} completed</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Present Rate</CardTitle></CardHeader>
          <CardContent>
              {loading ? <Skeleton className="h-8 w-20" /> : (
              <>
                <p className={`text-2xl font-bold ${(data?.calendar.reduce((s, d) => s + (d.present ?? 0) + (d.late ?? 0), 0) ?? 0) > 0 ? 'text-green-600' : 'text-muted-foreground'}`}>
                  {(() => {
                    if (!data || !data.calendar?.length) return '0'
                    const attended = data.calendar.reduce((s, d) => s + (d.present ?? 0) + (d.late ?? 0), 0)
                    const total = data.calendar.reduce((s, d) => s + (d.total ?? 0), 0)
                    return total > 0 ? Math.round((attended / total) * 100) : 0
                  })()}%
                </p>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Absences</CardTitle></CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-8 w-20" /> : (
              <p className="text-2xl font-bold text-red-600">
                {data?.calendar.reduce((s, d) => s + d.absent, 0) ?? 0}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="md:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
                  <ChevronLeft className="h-5 w-5" />
                </Button>
                <div className="flex items-center gap-2">
                  <select className="h-9 rounded-md border px-3 text-sm" value={month} onChange={e => setMonth(Number(e.target.value))}>
                    {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                  </select>
                  <select className="h-9 rounded-md border px-3 text-sm" value={year} onChange={e => setYear(Number(e.target.value))}>
                    {years.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
                <Button variant="ghost" size="icon" onClick={() => navigate(1)}>
                  <ChevronRight className="h-5 w-5" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-7 gap-px mb-1">
                    {DAY_HEADERS.map(h => (
                      <div key={h} className="p-2 text-center text-xs font-medium text-muted-foreground">{h}</div>
                    ))}
                  </div>
                  {calendarGrid.map((week, wi) => (
                    <div key={wi} className="grid grid-cols-7 gap-px">
                      {week.map((day, di) => {
                        if (!day) return <div key={di} className="min-h-[72px] rounded-md bg-muted/20" />
                        const dateStr = typeof day.date === 'string' && day.date.length === 10 ? day.date : null
                        const dayNum = dateStr ? Number(dateStr.slice(8, 10)) : null
                        const numDay = Number.isFinite(dayNum) ? dayNum : null
                        const isToday = dateStr === today
                        const isSelected = dateStr === selectedDate
                        const isPast = dateStr ? dateStr <= today : false

                        return (
                          <button
                            key={dateStr ?? `empty-${di}`}
                            onClick={() => dateStr && handleDateClick(dateStr)}
                            className={`min-h-[72px] rounded-md border p-1.5 text-left text-xs transition-colors hover:ring-2 hover:ring-primary/30 ${getDayColor(day)} ${
                              isToday ? 'ring-2 ring-primary' : ''
                            } ${isSelected ? 'ring-2 ring-primary ring-offset-2' : ''}`}
                          >
                            <span className={`font-semibold text-sm ${isToday ? 'text-primary' : ''}`}>{numDay ?? '?'}</span>
                            {isPast && (
                              <div className="mt-0.5 space-y-0.5">
                                {day.day_type === 'working_day' && (
                                  <div className="flex gap-0.5">
                                    {day.present > 0 && (
                                      <span className="inline-flex items-center gap-0.5 text-[10px] text-green-600">
                                        <CheckCircle2 className="h-2.5 w-2.5" />{day.present}
                                      </span>
                                    )}
                                    {day.late > 0 && (
                                      <span className="inline-flex items-center gap-0.5 text-[10px] text-yellow-600">
                                        <Clock className="h-2.5 w-2.5" />{day.late}
                                      </span>
                                    )}
                                    {day.absent > 0 && (
                                      <span className="inline-flex items-center gap-0.5 text-[10px] text-red-600">
                                        <XCircle className="h-2.5 w-2.5" />{day.absent}
                                      </span>
                                    )}
                                    {day.present === 0 && day.late === 0 && day.absent === 0 && (
                                      <span className="text-[10px] text-muted-foreground">No records</span>
                                    )}
                                  </div>
                                )}
                                {day.day_type !== 'working_day' && (
                                  <span className="text-[10px] text-muted-foreground truncate block">{day.title}</span>
                                )}
                              </div>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  ))}
                </>
              )}

              <div className="flex flex-wrap gap-4 mt-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded-sm bg-green-50 border border-green-200" /> Completed
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded-sm bg-red-50 border border-red-200" /> Missing
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded-sm bg-yellow-50 border border-yellow-200" /> Holiday/Event
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded-sm bg-blue-50 border border-blue-200" /> Weekend
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        <div>
          {detailLoading ? (
            <Card><CardContent className="p-6 space-y-3"><Skeleton className="h-6 w-32" />{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</CardContent></Card>
          ) : dayDetail ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CalendarDays className="h-4 w-4" />
                  {(() => {
                    const d = new Date(dayDetail.date + 'T12:00:00')
                    return Number.isFinite(d.getTime())
                      ? d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
                      : dayDetail.date
                  })()}
                </CardTitle>
                <p className="text-sm text-muted-foreground capitalize">{dayDetail.day_type.replace('_', ' ')}{dayDetail.title ? ` - ${dayDetail.title}` : ''}</p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-green-50 dark:bg-green-950/20 p-3 text-center">
                    <p className="text-2xl font-bold text-green-600">{dayDetail.summary.present}</p>
                    <p className="text-xs text-muted-foreground">Present</p>
                  </div>
                  <div className="rounded-lg bg-yellow-50 dark:bg-yellow-950/20 p-3 text-center">
                    <p className="text-2xl font-bold text-yellow-600">{dayDetail.summary.late}</p>
                    <p className="text-xs text-muted-foreground">Late</p>
                  </div>
                  <div className="rounded-lg bg-red-50 dark:bg-red-950/20 p-3 text-center">
                    <p className="text-2xl font-bold text-red-600">{dayDetail.summary.absent}</p>
                    <p className="text-xs text-muted-foreground">Absent</p>
                  </div>
                  <div className="rounded-lg bg-blue-50 dark:bg-blue-950/20 p-3 text-center">
                    <p className="text-2xl font-bold text-blue-600">{dayDetail.summary.attendance_rate}%</p>
                    <p className="text-xs text-muted-foreground">Rate</p>
                  </div>
                </div>

                {dayDetail.day_type === 'working_day' && dayDetail.records.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium mb-2">Attendance Records</h4>
                    <div className="max-h-64 overflow-y-auto space-y-1">
                      {dayDetail.records.map(r => (
                        <div key={r.id} className="flex items-center justify-between rounded-md bg-muted/30 px-3 py-2 text-xs">
                          <div>
                            <p className="font-medium">{(r as any).teacher?.full_name ?? 'Unknown'}</p>
                            <p className="text-muted-foreground">{(r as any).teacher?.staff_number ?? ''}</p>
                          </div>
                          <div className="text-right">
                            <p>{r.check_in ? new Date(r.check_in).toLocaleTimeString() : '-'} {r.check_out ? `- ${new Date(r.check_out).toLocaleTimeString()}` : ''}</p>
                            <span className={`text-[10px] font-medium ${
                              r.status === 'present' ? 'text-green-600' :
                              r.status === 'late' ? 'text-yellow-600' :
                              r.status === 'absent' ? 'text-red-600' :
                              'text-blue-600'
                            }`}>{r.status}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {dayDetail.day_type === 'working_day' && dayDetail.records.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">No attendance records for this date</p>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-12 text-center text-muted-foreground">
                <CalendarDays className="mx-auto h-8 w-8 mb-2 opacity-50" />
                <p className="text-sm">Select a date to view attendance details</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
    </>
  )
}