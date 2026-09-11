import { lazy, Suspense, useMemo } from 'react'
import { Skeleton } from '@/components/ui/skeleton'

interface TeacherStats {
  full_name: string
  present: number
  absent: number
}

const LazyBarChart = lazy(() =>
  import('recharts').then((m) => ({
    default: function RechartsBarChart({ data }: { data: TeacherStats[] }) {
      const { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } = m
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="full_name" tick={{ fontSize: 10 }} />
            <YAxis />
            <Tooltip />
            <Bar dataKey="present" fill="hsl(142.1, 76.2%, 36.3%)" name="Present" stackId="a" />
            <Bar dataKey="absent" fill="hsl(0, 72.2%, 50.6%)" name="Absent" stackId="a" />
          </BarChart>
        </ResponsiveContainer>
      )
    },
  }))
)

export function PresentAbsentChart({ data }: { data: TeacherStats[] }) {
  const summary = useMemo(
    () =>
      data
        .slice(0, 10)
        .map((d) => `${d.full_name}: ${d.present} present, ${d.absent} absent`)
        .join('; '),
    [data]
  )

  return (
    <div
      className="h-72"
      role="img"
      aria-label={`Present vs absent chart. ${data.length > 0 ? summary : 'No data'}`}
    >
      <div className="sr-only">
        <table>
          <caption>Teacher present/absent data</caption>
          <thead>
            <tr>
              <th>Teacher</th>
              <th>Present</th>
              <th>Absent</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.full_name}>
                <td>{d.full_name}</td>
                <td>{d.present}</td>
                <td>{d.absent}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Suspense
        fallback={<Skeleton className="h-72 w-full" aria-label="Loading present/absent chart" />}
      >
        <LazyBarChart data={data} />
      </Suspense>
    </div>
  )
}
