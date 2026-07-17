import { useState, useEffect } from 'react'
import { formatDate, formatTime } from '@/lib/format'
import { Clock } from 'lucide-react'

export function ClockWidget() {
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
        <Clock className="h-5 w-5 text-primary" />
      </div>
      <div>
        <p className="text-sm font-medium">{formatDate(now)}</p>
        <p className="text-2xl font-bold tracking-tight">{formatTime(now)}</p>
      </div>
    </div>
  )
}
