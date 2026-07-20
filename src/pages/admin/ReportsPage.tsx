import { useState, useEffect } from 'react'
import { Helmet } from 'react-helmet-async'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { getDailyReportEdge, getMonthlyReportEdge, getAttendanceAnalytics } from '@/services/attendanceApi'
import type { DailyReport, MonthlyReportResult, AIAnalysisResult } from '@/services/attendanceApi'
import { exportToCSV, exportToExcel, exportToPDF } from '@/services/admin'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { format } from 'date-fns'
import { Download, Brain, Lightbulb, AlertTriangle, TrendingUp } from 'lucide-react'
import { toast } from 'sonner'

const currentYear = new Date().getFullYear()
const years = Array.from({ length: 10 }, (_, i) => currentYear - 5 + i)

export default function ReportsPage() {
  const today = format(new Date(), 'yyyy-MM-dd')
  const [year, setYear] = useState(currentYear)
  const [month, setMonth] = useState(new Date().getMonth() + 1)

  const [daily, setDaily] = useState<DailyReport | null>(null)
  const [monthly, setMonthly] = useState<MonthlyReportResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [aiData, setAiData] = useState<AIAnalysisResult | null>(null)
  const [aiLoading, setAiLoading] = useState(false)

  useEffect(() => {
    setLoading(true)

    Promise.all([
      getDailyReportEdge(today),
      getMonthlyReportEdge(year, month),
    ])
      .then(([dailyResult, monthlyResult]) => {
        setDaily(dailyResult)
        setMonthly(monthlyResult)
      })
      .catch(() => toast.error('Failed to load reports'))
      .finally(() => setLoading(false))
  }, [today, year, month])

  const runAiAnalysis = async () => {
    setAiLoading(true)
    try {
      const result = await getAttendanceAnalytics({ year, month })
      setAiData(result)
      toast.success('AI analysis complete')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'AI analysis failed')
    } finally {
      setAiLoading(false)
    }
  }

  const handleExport = async (format: 'csv' | 'xlsx' | 'pdf') => {
    const { records } = await import('@/services/admin').then(m =>
      m.getAttendanceRecords({ date: `${year}-${String(month).padStart(2, '0')}-01`, page_size: 500 })
    )
    const filename = `monthly_report_${year}_${month}`
    if (format === 'csv') exportToCSV(records, filename)
    else if (format === 'xlsx') exportToExcel(records, filename)
    else exportToPDF(records, filename)
    toast.success(`Report exported as ${format.toUpperCase()}`)
  }

  if (loading) {
    return (
      <>
        <Helmet>
          <title>Reports — Admin | JK Attendance System</title>
          <meta name="description" content="Attendance reports and analytics" />
          <meta name="robots" content="noindex, follow" />
        </Helmet>
        <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
        <div className="grid gap-4 md:grid-cols-2">
          <Card><CardHeader><Skeleton className="h-6 w-24" /></CardHeader><CardContent className="space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}</CardContent></Card>
          <Card><CardHeader><Skeleton className="h-6 w-32" /></CardHeader><CardContent className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}</CardContent></Card>
        </div>
        <Card><CardHeader><Skeleton className="h-6 w-48" /></CardHeader><CardContent><Skeleton className="h-72 w-full" /></CardContent></Card>
      </div>
      </>
    )
  }

  return (
    <>
      <Helmet>
        <title>Reports — Admin | JK Attendance System</title>
        <meta name="description" content="Attendance reports and analytics" />
        <meta name="robots" content="noindex, follow" />
      </Helmet>
      <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => handleExport('csv')}>
            <Download className="mr-2 h-4 w-4" />CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleExport('xlsx')}>
            <Download className="mr-2 h-4 w-4" />Excel
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleExport('pdf')}>
            <Download className="mr-2 h-4 w-4" />PDF
          </Button>
          <Button variant="secondary" size="sm" onClick={runAiAnalysis} loading={aiLoading}>
            <Brain className="mr-2 h-4 w-4" />AI Insights
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-lg">Today</CardTitle></CardHeader>
          <CardContent>
            {daily ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Attendance Rate</span><span className="font-bold text-lg">{daily.attendance_rate}%</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Present</span><span>{daily.present}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Late</span><span>{daily.late}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Absent</span><span>{daily.absent}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Avg Check In</span><span>{daily.avg_check_in_time}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Avg Working Min</span><span>{daily.avg_working_minutes}</span></div>
              </div>
            ) : <p className="text-muted-foreground">No data</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              <span className="flex items-center gap-2">
                Monthly Summary
                <select className="ml-auto h-8 rounded border px-2 text-sm" value={month} onChange={e => setMonth(Number(e.target.value))}>
                  {Array.from({ length: 12 }, (_, i) => (
                    <option key={i + 1} value={i + 1}>{format(new Date(2024, i), 'MMMM')}</option>
                  ))}
                </select>
                <select className="h-8 rounded border px-2 text-sm" value={year} onChange={e => setYear(Number(e.target.value))}>
                  {years.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {monthly ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Attendance Rate</span><span className="font-bold text-lg">{monthly.summary.attendance_percentage}%</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Present Days</span><span>{monthly.summary.present_days}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Late Days</span><span>{monthly.summary.late_days}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Absent Days</span><span>{monthly.summary.absent_days}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Avg Working</span><span>{monthly.summary.avg_working_hours} hrs</span></div>
              </div>
            ) : <p className="text-muted-foreground">No data</p>}
          </CardContent>
        </Card>
      </div>

      {monthly && monthly.teachers && monthly.teachers.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-lg">Per-Teacher Attendance</CardTitle></CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthly.teachers.slice(0, 20)}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="full_name" tick={{ fontSize: 10 }} />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="present" fill="hsl(142.1, 76.2%, 36.3%)" name="Present" stackId="a" />
                  <Bar dataKey="late" fill="hsl(48, 96.5%, 53.5%)" name="Late" stackId="a" />
                  <Bar dataKey="absent" fill="hsl(0, 72.2%, 50.6%)" name="Absent" stackId="a" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {monthly && monthly.teachers && monthly.teachers.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-lg">Present vs Absent (Monthly)</CardTitle></CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthly.teachers.slice(0, 20)}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="full_name" tick={{ fontSize: 10 }} />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="present" fill="hsl(142.1, 76.2%, 36.3%)" name="Present" stackId="a" />
                  <Bar dataKey="absent" fill="hsl(0, 72.2%, 50.6%)" name="Absent" stackId="a" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {aiData && (
        <Card className="border-primary/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Brain className="h-5 w-5 text-primary" />
              AI Attendance Insights
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-lg border bg-card p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <TrendingUp className="h-4 w-4" />
                  Attendance Rate
                </div>
                <p className={`text-2xl font-bold ${(aiData.insights.summary.attendance_rate ?? 0) >= 90 ? 'text-green-600' : (aiData.insights.summary.attendance_rate ?? 0) >= 75 ? 'text-yellow-600' : 'text-red-600'}`}>
                  {aiData.insights.summary.attendance_rate}%
                </p>
              </div>
              <div className="rounded-lg border bg-card p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <AlertTriangle className="h-4 w-4" />
                  Frequent Late
                </div>
                <p className="text-2xl font-bold text-yellow-600">
                  {aiData.insights.teachers_with_frequent_lateness.length}
                </p>
                <p className="text-xs text-muted-foreground">teachers</p>
              </div>
              <div className="rounded-lg border bg-card p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <AlertTriangle className="h-4 w-4" />
                  High Absenteeism
                </div>
                <p className="text-2xl font-bold text-red-600">
                  {aiData.insights.teachers_with_high_absenteeism.length}
                </p>
                <p className="text-xs text-muted-foreground">teachers</p>
              </div>
            </div>

            {aiData.insights.suggestions.length > 0 && (
              <div>
                <h4 className="flex items-center gap-2 text-sm font-medium mb-3">
                  <Lightbulb className="h-4 w-4 text-yellow-500" />
                  Suggestions
                </h4>
                <ul className="space-y-2">
                  {aiData.insights.suggestions.map((s, i) => (
                    <li key={i} className="rounded-md bg-muted/50 px-3 py-2 text-sm">{s}</li>
                  ))}
                </ul>
              </div>
            )}

            {aiData.insights.teachers_with_frequent_lateness.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2">Teachers with Frequent Lateness</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th scope="col" className="pb-2 font-medium">Name</th>
                        <th scope="col" className="pb-2 font-medium">Late Count</th>
                        <th scope="col" className="pb-2 font-medium">Avg Late (min)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {aiData.insights.teachers_with_frequent_lateness.map((t) => (
                        <tr key={t.teacher_id} className="border-b last:border-0">
                          <td className="py-1.5">{t.name}</td>
                          <td className="py-1.5 font-medium text-yellow-600">{t.late_count}</td>
                          <td className="py-1.5">{t.avg_late_minutes} min</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {aiData.insights.teachers_with_high_absenteeism.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2">Teachers with High Absenteeism</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th scope="col" className="pb-2 font-medium">Name</th>
                        <th scope="col" className="pb-2 font-medium">Absent Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {aiData.insights.teachers_with_high_absenteeism.map((t) => (
                        <tr key={t.teacher_id} className="border-b last:border-0">
                          <td className="py-1.5">{t.name}</td>
                          <td className="py-1.5 font-medium text-red-600">{t.absent_count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {aiData.ai_generated && aiData.ai_generated.recommendations && (
              <div>
                <h4 className="flex items-center gap-2 text-sm font-medium mb-3">
                  <Brain className="h-4 w-4 text-purple-500" />
                  AI Recommendations ({aiData.ai_generated.provider})
                </h4>
                <ul className="space-y-2">
                  {aiData.ai_generated.recommendations.map((r, i) => (
                    <li key={i} className="rounded-md bg-primary/5 border border-primary/10 px-3 py-2 text-sm">{r}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
    </>
  )
}
