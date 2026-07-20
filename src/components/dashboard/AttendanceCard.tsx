import { useState, useEffect } from 'react'
import {
  useTodayAttendance,
  useCheckOut,
  useUndoCheckOut,
} from '@/hooks/useAttendance'
import { useLocationAttendance } from '@/hooks/useLocationAttendance'
import { useAuth } from '@/hooks/useAuth'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Loader2,
  LogIn,
  LogOut,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Clock,
  Timer,
  XCircle,
  Undo2,
  MapPin,
  Crosshair,
  Sun,
  RefreshCw,
} from 'lucide-react'
import { minutesToHours } from '@/lib/format'

const statusConfig: Record<
  string,
  { label: string; color: string; bg: string; icon: typeof CheckCircle2 }
> = {
  PRESENT: { label: 'Present', color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-950/30', icon: CheckCircle2 },
  present: { label: 'Present', color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-950/30', icon: CheckCircle2 },
  LATE: { label: 'Late', color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-950/30', icon: AlertTriangle },
  late: { label: 'Late', color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-950/30', icon: AlertTriangle },
  COMPLETE_DAY: { label: 'Complete Day', color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-950/30', icon: CheckCircle2 },
  EARLY_DEPARTURE: { label: 'Early Departure', color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-950/30', icon: Timer },
  ABSENT: { label: 'Absent', color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-950/30', icon: XCircle },
  absent: { label: 'Absent', color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-950/30', icon: XCircle },
  checked_out: { label: 'Checked Out', color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-950/30', icon: CheckCircle2 },
}

export function AttendanceCard() {
  const { user, profileError, refreshProfile } = useAuth()
  const { data: attendance, isLoading, isError } = useTodayAttendance()
  const checkOutMutation = useCheckOut()
  const undoCheckOutMutation = useUndoCheckOut()

  const {
    checkingIn,
    error: gpsError,
    distance,
    locationStatus,
    gpsAccuracy,
    successMessage,
    checkIn: gpsCheckIn,
    clearError: clearGpsError,
    clearSuccess: clearGpsSuccess,
  } = useLocationAttendance()

  const [actionError, setActionError] = useState<string | null>(null)
  const [undoCountdown, setUndoCountdown] = useState<number | null>(null)

  const displayError = actionError || gpsError

  useEffect(() => {
    const expiresAt = attendance?.check_out_expires_at
    if (!expiresAt) {
      setUndoCountdown(null)
      return
    }
    const tick = () => {
      setUndoCountdown(
        Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000))
      )
    }
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [attendance?.check_out_expires_at])

  const teacher = user?.teacher
  if (!teacher) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <AlertCircle className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="font-medium">Profile not loaded</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {profileError || 'Your teacher profile could not be loaded. Please try again.'}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={refreshProfile}>
              <RefreshCw className="mr-1 h-4 w-4" /> Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  const isCheckedIn = !!attendance?.check_in
  const isCheckedOut = !!attendance?.check_out
  const statusKey = attendance?.attendance_status ?? attendance?.status ?? 'absent'
  const config = statusConfig[statusKey] ?? statusConfig.absent
  const StatusIcon = config.icon

  const actionPending = checkingIn || checkOutMutation.isPending || undoCheckOutMutation.isPending

  const showUndo = undoCountdown !== null && undoCountdown > 0
  const showDistance = distance !== null && locationStatus !== null
  const showGpsInfo = gpsAccuracy !== null
  const showAttachedGps =
    isCheckedIn && attendance?.distance_from_school != null && attendance?.location_status

  const handleCheckIn = () => {
    setActionError(null)
    clearGpsError()
    clearGpsSuccess()
    gpsCheckIn()
  }

  const handleCheckOut = () => {
    if (!attendance) return
    setActionError(null)
    clearGpsError()
    checkOutMutation.mutate(attendance.id, {
      onError: (err) => {
        setActionError(err instanceof Error ? err.message : 'Check-out failed')
      },
    })
  }

  const handleUndo = () => {
    if (!attendance) return
    setActionError(null)
    clearGpsError()
    undoCheckOutMutation.mutate(attendance.id, {
      onError: (err) => {
        setActionError(err instanceof Error ? err.message : 'Undo failed')
      },
    })
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center p-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center gap-2 p-6">
          <AlertCircle className="h-5 w-5 text-destructive" />
          <p className="text-sm text-destructive">Failed to load today's attendance</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Today's Attendance</p>
            <div
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${config.bg} ${config.color}`}
            >
              <StatusIcon className="h-3.5 w-3.5" />
              {config.label}
            </div>
          </div>
          {!isCheckedIn && (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
              <Clock className="h-4 w-4 text-muted-foreground" />
            </div>
          )}
        </div>

        {isCheckedIn && (
          <div className="mt-3 space-y-1.5 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <LogIn className="h-3.5 w-3.5" />
              <span>
                Checked in at{' '}
                {new Date(attendance.check_in!).toLocaleTimeString('en-US', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
            {attendance.attendance_status === 'LATE' && attendance.late_minutes != null && attendance.late_minutes > 0 && (
              <p className="text-xs text-amber-600">
                Late by {attendance.late_minutes} minute{attendance.late_minutes !== 1 ? 's' : ''}
              </p>
            )}
            {attendance.attendance_status === 'EARLY_DEPARTURE' && attendance.early_departure_minutes != null && attendance.early_departure_minutes > 0 && (
              <p className="text-xs text-orange-600">
                Left {attendance.early_departure_minutes} minute{attendance.early_departure_minutes !== 1 ? 's' : ''} early
              </p>
            )}
            {attendance.working_hours && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Sun className="h-3.5 w-3.5" />
                <span>Worked {attendance.working_hours}</span>
              </div>
            )}
            {showAttachedGps && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" />
                <span>
                  {attendance.distance_from_school}m from school &middot;{' '}
                  {attendance.location_status === 'inside_school'
                    ? 'Inside compound'
                    : 'Outside compound'}
                </span>
              </div>
            )}
            {isCheckedOut && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <LogOut className="h-3.5 w-3.5" />
                <span>
                  Checked out at{' '}
                  {new Date(attendance.check_out!).toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            )}
            {isCheckedOut && attendance.working_minutes != null && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Timer className="h-3.5 w-3.5" />
                <span>Worked {minutesToHours(attendance.working_minutes)}</span>
              </div>
            )}
          </div>
        )}

        <div className="mt-4 space-y-3">
          {showDistance && locationStatus === 'inside_school' && (
            <div className="flex items-center gap-3 rounded-md border bg-emerald-50 px-3 py-2 text-xs dark:bg-emerald-950/20">
              <Crosshair className="h-4 w-4 text-emerald-600" />
              <div>
                <p className="font-medium text-emerald-700 dark:text-emerald-300">
                  Distance from School: {distance} meters
                </p>
                <p className="text-emerald-600/70 dark:text-emerald-400/70">
                  Status: Inside School Compound
                  {showGpsInfo && ` · Accuracy: ±${gpsAccuracy}m`}
                </p>
              </div>
            </div>
          )}

          {showDistance && locationStatus === 'outside_school' && (
            <div className="flex items-center gap-3 rounded-md border bg-red-50 px-3 py-2 text-xs dark:bg-red-950/20">
              <MapPin className="h-4 w-4 text-red-600" />
              <div>
                <p className="font-medium text-red-700 dark:text-red-300">
                  Distance from School: {distance} meters
                </p>
                <p className="text-red-600/70 dark:text-red-400/70">
                  Status: Outside School Compound
                </p>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            {!isCheckedIn && (
              <Button className="flex-1" onClick={handleCheckIn} disabled={actionPending}>
                {checkingIn ? (
                  <>
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" /> Getting GPS location...
                  </>
                ) : (
                  <>
                    <LogIn className="mr-1 h-4 w-4" /> Check In
                  </>
                )}
              </Button>
            )}

            {isCheckedIn && !isCheckedOut && (
              <Button
                className="flex-1"
                variant="outline"
                onClick={handleCheckOut}
                disabled={actionPending}
              >
                {checkOutMutation.isPending ? (
                  <>
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" /> Checking out...
                  </>
                ) : (
                  <>
                    <LogOut className="mr-1 h-4 w-4" /> Check Out
                  </>
                )}
              </Button>
            )}

            {isCheckedOut && showUndo && (
              <Button
                className="flex-1"
                variant="secondary"
                onClick={handleUndo}
                disabled={actionPending}
              >
                {undoCheckOutMutation.isPending ? (
                  <>
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" /> Undoing...
                  </>
                ) : (
                  <>
                    <Undo2 className="mr-1 h-4 w-4" /> Undo ({undoCountdown}s)
                  </>
                )}
              </Button>
            )}

            {isCheckedOut && !showUndo && (
              <div className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Today's attendance complete
              </div>
            )}
          </div>

          {successMessage && !isCheckedIn && (
            <div className="flex items-center gap-2 rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          {displayError && (
            <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{displayError}</span>
            </div>
          )}

          {!isCheckedIn && (
            <p className="text-[10px] text-muted-foreground/50">
              GPS location will be captured for verification. Must be within school premises.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
