import { useAttendanceSummary } from '@/hooks/useAttendance'
import { Card, CardContent } from '@/components/ui/card'
import { Calendar, CheckCircle2, AlertTriangle, XCircle, Loader2 } from 'lucide-react'

const summaryItems = [
  { key: 'total', label: 'Total', icon: Calendar, color: 'text-muted-foreground' },
  { key: 'present', label: 'Present', icon: CheckCircle2, color: 'text-emerald-600' },
  { key: 'late', label: 'Late', icon: AlertTriangle, color: 'text-amber-600' },
  { key: 'absent', label: 'Absent', icon: XCircle, color: 'text-red-600' },
] as const

export function SummaryCard() {
  const { data: summary, isLoading, isError } = useAttendanceSummary()

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center p-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  if (isError || !summary) {
    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground">No records this month</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className="p-4">
        <p className="mb-3 text-xs font-medium text-muted-foreground">
          This Month
        </p>
        <div className="grid grid-cols-4 gap-3">
          {summaryItems.map(({ key, label, icon: Icon, color }) => {
            const value = summary[key as keyof typeof summary] ?? 0
            return (
              <div key={key} className="text-center">
                <Icon className={`mx-auto h-4 w-4 ${color}`} />
                <p className="mt-1 text-lg font-bold">{value}</p>
                <p className="text-[10px] text-muted-foreground">{label}</p>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
