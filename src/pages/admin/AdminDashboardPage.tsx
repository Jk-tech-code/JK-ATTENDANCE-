import { useEffect, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { getDashboardStats, getTeachers } from '@/services/admin'
import { getDailyReportEdge } from '@/services/attendanceApi'
import type { DashboardStats } from '@/services/admin'
import { Users, Clock, AlertTriangle, CheckCircle, LogOut, MapPin, Timer } from 'lucide-react'
import { format } from 'date-fns'

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [daily, setDaily] = useState<any>(null)
  const [teachers, setTeachers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      getDashboardStats(),
      getDailyReportEdge(format(new Date(), 'yyyy-MM-dd')),
      getTeachers(),
    ])
      .then(([s, d, t]) => {
        setStats(s)
        setDaily(d)
        setTeachers(t)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const cards = [
    { label: 'Total Teachers', value: stats?.total_teachers ?? 0, icon: Users, color: 'text-blue-600' },
    { label: 'Present Today', value: stats?.present_today ?? 0, icon: CheckCircle, color: 'text-green-600' },
    { label: 'Late Today', value: stats?.late_today ?? 0, icon: Clock, color: 'text-yellow-600' },
    { label: 'Absent Today', value: stats?.absent_today ?? 0, icon: AlertTriangle, color: 'text-red-600' },
    { label: 'Checked Out', value: stats?.checked_out_today ?? 0, icon: LogOut, color: 'text-purple-600' },
    { label: 'In School Now', value: stats?.in_school_now ?? 0, icon: MapPin, color: 'text-indigo-600' },
    { label: 'Early Departure', value: (stats as any)?.early_departure_today ?? 0, icon: Timer, color: 'text-orange-600' },
  ]

  return (
    <>
      <Helmet>
        <title>Dashboard — Admin | JK Attendance System</title>
        <meta name="description" content="Admin attendance dashboard with real-time stats" />
        <meta name="robots" content="noindex, follow" />
      </Helmet>
      <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">{c.label}</CardTitle>
              <c.icon className={`h-4 w-4 ${c.color}`} />
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-2xl font-bold">{c.value}</div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {loading ? (
        <Card>
          <CardHeader><Skeleton className="h-6 w-40" /></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i}>
                  <Skeleton className="h-4 w-24 mb-2" />
                  <Skeleton className="h-7 w-16" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : daily && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Today's Report</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Attendance Rate</span>
                <p className="text-xl font-bold">{daily.attendance_rate}%</p>
              </div>
              <div>
                <span className="text-muted-foreground">Average Check In</span>
                <p className="text-xl font-bold">{daily.avg_check_in_time}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Avg Working Min</span>
                <p className="text-xl font-bold">{daily.avg_working_minutes}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Total Teachers</span>
                <p className="text-xl font-bold">{daily.total_teachers}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Teachers</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 font-medium">Staff No.</th>
                    <th className="pb-2 font-medium">Name</th>
                    <th className="pb-2 font-medium">Department</th>
                    <th className="pb-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {teachers.map((t) => (
                    <tr key={t.id} className="border-b last:border-0">
                      <td className="py-2">{t.staff_number}</td>
                      <td className="py-2 font-medium">{t.full_name}</td>
                      <td className="py-2 text-muted-foreground">{t.department ?? '-'}</td>
                      <td className="py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          t.employment_status === 'active' ? 'bg-green-100 text-green-700' :
                          t.employment_status === 'inactive' ? 'bg-gray-100 text-gray-600' :
                          'bg-red-100 text-red-700'
                        }`}>
                          {t.employment_status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
    </>
  )
}
