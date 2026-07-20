import { useEffect, useState, type JSX } from 'react'
import { Skeleton } from '@/components/ui/skeleton'

interface TeacherStats {
  full_name: string
  present: number
  late: number
  absent: number
}

export function AttendanceBarChart({ data }: { data: TeacherStats[] }) {
  const [Chart, setChart] = useState<JSX.Element | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false

    import('recharts')
      .then(({ BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer }) => {
        if (cancelled) return
        setChart(
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="full_name" tick={{ fontSize: 10 }} />
              <YAxis />
              <Tooltip />
              <Bar dataKey="present" fill="hsl(142.1, 76.2%, 36.3%)" name="Present" stackId="a" />
              <Bar dataKey="late" fill="hsl(48, 96.5%, 53.5%)" name="Late" stackId="a" />
              <Bar dataKey="absent" fill="hsl(0, 72.2%, 50.6%)" name="Absent" stackId="a" />
            </BarChart>
          </ResponsiveContainer>,
        )
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })

    return () => { cancelled = true }
  }, [data])

  if (error) {
    return (
      <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
        Failed to load chart
      </div>
    )
  }

  if (!Chart) {
    return <Skeleton className="h-72 w-full" />
  }

  return <div className="h-72">{Chart}</div>
}
