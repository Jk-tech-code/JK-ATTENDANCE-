import { useState, useEffect } from 'react'
import { Helmet } from 'react-helmet-async'
import { supabase } from '@/services/supabase'
import { captureGpsPosition, haversineDistance } from '@/services/location'
import { detectDevice, detectBrowser } from '@/lib/device'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Loader2,
  MapPin,
  Crosshair,
  Save,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Globe,
  Smartphone,
  Monitor,
  Clock,
  Timer,
} from 'lucide-react'

interface SchoolSettingsData {
  id: string
  school_name: string | null
  latitude: number | null
  longitude: number | null
  allowed_radius_meters: number | null
  active: boolean | null
  reporting_start_time: string | null
  grace_period_minutes: number | null
  checkout_time: string | null
  weekend_working_days: string | null
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<SchoolSettingsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const [testLat, setTestLat] = useState<number | null>(null)
  const [testLng, setTestLng] = useState<number | null>(null)
  const [testDist, setTestDist] = useState<number | null>(null)
  const [testing, setTesting] = useState(false)
  const [testMsg, setTestMsg] = useState<string | null>(null)

  const [deviceInfo] = useState(() => ({
    device: detectDevice(),
    browser: detectBrowser(),
  }))

  const [attendanceWithGps, setAttendanceWithGps] = useState<any[]>([])
  const [loadingAttendance, setLoadingAttendance] = useState(false)

  useEffect(() => {
    loadSettings()
    loadAttendanceWithGps()
  }, [])

  async function loadSettings() {
    setLoading(true)
    const { data } = await supabase
      .from('school_settings')
      .select('*')
      .limit(1)
      .single()
    setSettings(data as SchoolSettingsData)
    setLoading(false)
  }

  async function loadAttendanceWithGps() {
    setLoadingAttendance(true)
    const { data } = await supabase
      .from('attendance')
      .select('id, teacher_id, attendance_date, check_in, teacher_latitude, teacher_longitude, distance_from_school, location_status, device, browser, gps_accuracy')
      .not('teacher_latitude', 'is', null)
      .order('created_at', { ascending: false })
      .limit(20)
    setAttendanceWithGps(data ?? [])
    setLoadingAttendance(false)
  }

  async function handleSave() {
    if (!settings) return
    setSaving(true)
    setSaveMsg(null)
    setSaveError(null)

    const { error } = await supabase
      .from('school_settings')
      .update({
        school_name: settings.school_name,
        latitude: settings.latitude,
        longitude: settings.longitude,
        allowed_radius_meters: settings.allowed_radius_meters,
        active: settings.active,
        reporting_start_time: settings.reporting_start_time,
        grace_period_minutes: settings.grace_period_minutes,
        checkout_time: settings.checkout_time,
      })
      .eq('id', settings.id)

    if (error) {
      setSaveError(error.message)
    } else {
      setSaveMsg('Settings saved successfully.')
    }
    setSaving(false)
  }

  async function handleTestLocation() {
    setTesting(true)
    setTestMsg(null)
    setTestDist(null)
    try {
      const gps = await captureGpsPosition()
      setTestLat(gps.latitude)
      setTestLng(gps.longitude)

      const schoolLat = settings?.latitude
      const schoolLng = settings?.longitude

      if (schoolLat == null || schoolLng == null) {
        setTestMsg('School GPS coordinates not configured. Please set latitude and longitude in the Location Configuration section first.')
        setTesting(false)
        return
      }

      const radius = settings?.allowed_radius_meters ?? 100
      const dist = haversineDistance(
        gps.latitude,
        gps.longitude,
        schoolLat,
        schoolLng
      )
      setTestDist(Math.round(dist))

      if (dist <= radius) {
        setTestMsg(`Inside school zone (${Math.round(dist)}m / ${radius}m radius)`)
      } else {
        setTestMsg(`Outside school zone (${Math.round(dist)}m — exceeds ${radius}m limit)`)
      }
    } catch (err) {
      setTestMsg(err instanceof Error ? err.message : 'GPS test failed')
    }
    setTesting(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!settings) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold">School Settings</h1>
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            No school settings found. Run the seed migration to create default settings.
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <>
      <Helmet>
        <title>Settings — Admin | JK Attendance System</title>
        <meta name="description" content="Configure school settings, GPS geofencing, and attendance time rules" />
        <meta name="robots" content="noindex, follow" />
      </Helmet>
      <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">School Settings</h1>
          <p className="text-sm text-muted-foreground">Manage GPS geofencing configuration</p>
        </div>
        <Badge variant={settings.active ? 'success' : 'secondary'}>
          {settings.active ? 'Active' : 'Inactive'}
        </Badge>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Globe className="h-4 w-4" />
              Location Configuration
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">School Name</label>
              <Input
                value={settings.school_name ?? ''}
                onChange={(e) =>
                  setSettings({ ...settings, school_name: e.target.value })
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-sm font-medium">Latitude</label>
                <Input
                  type="number"
                  step="0.000001"
                  value={settings.latitude ?? ''}
                  onChange={(e) =>
                    setSettings({ ...settings, latitude: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Longitude</label>
                <Input
                  type="number"
                  step="0.000001"
                  value={settings.longitude ?? ''}
                  onChange={(e) =>
                    setSettings({ ...settings, longitude: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Allowed Radius (meters)
              </label>
              <Input
                type="number"
                min={1}
                value={settings.allowed_radius_meters ?? 100}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    allowed_radius_meters: parseInt(e.target.value) || 100,
                  })
                }
              />
              <p className="text-[10px] text-muted-foreground">
                Current: {settings.school_name ?? 'School'} ({settings.latitude?.toFixed(4) ?? 'N/A'}, {settings.longitude?.toFixed(4) ?? 'N/A'}) &middot;{' '}
                {settings.allowed_radius_meters ?? 100}m radius
              </p>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={settings.active ?? true}
                  onChange={(e) =>
                    setSettings({ ...settings, active: e.target.checked })
                  }
                  className="rounded border-input"
                />
                Active (geofencing enabled)
              </label>
            </div>

            <Button onClick={handleSave} disabled={saving} className="w-full">
              {saving ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-1 h-4 w-4" />
              )}
              Save Settings
            </Button>

            {saveMsg && (
              <div className="flex items-center gap-2 rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                {saveMsg}
              </div>
            )}
            {saveError && (
              <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {saveError}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4" />
              Attendance Time Rules
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Reporting Start Time</label>
              <Input
                type="time"
                value={settings.reporting_start_time?.substring(0, 5) ?? '07:00'}
                onChange={(e) =>
                  setSettings({ ...settings, reporting_start_time: e.target.value + ':00' })
                }
              />
              <p className="text-[10px] text-muted-foreground">
                Official reporting time (default: 07:00)
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Grace Period (minutes)</label>
              <Input
                type="number"
                min={0}
                max={120}
                value={settings.grace_period_minutes ?? 20}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    grace_period_minutes: parseInt(e.target.value) || 0,
                  })
                }
              />
              <p className="text-[10px] text-muted-foreground">
                Allowed late window after reporting time (default: 20 min)
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Official Checkout Time</label>
              <Input
                type="time"
                value={settings.checkout_time?.substring(0, 5) ?? '17:30'}
                onChange={(e) =>
                  setSettings({ ...settings, checkout_time: e.target.value + ':00' })
                }
              />
              <p className="text-[10px] text-muted-foreground">
                Departure time (default: 17:30 / 5:30 PM)
              </p>
            </div>

            <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-1">
              <p className="font-medium text-foreground">Status Rules</p>
              <p><span className="text-emerald-600 font-medium">PRESENT</span>: Check-in between reporting start and grace period end</p>
              <p><span className="text-amber-600 font-medium">LATE</span>: Check-in after grace period ends</p>
              <p><span className="text-red-600 font-medium">ABSENT</span>: No check-in recorded</p>
              <p><span className="text-blue-600 font-medium">COMPLETE DAY</span>: Checked in on time and out at/after checkout time</p>
              <p><span className="text-orange-600 font-medium">EARLY DEPARTURE</span>: Checked out before checkout time</p>
            </div>

            <Button onClick={handleSave} disabled={saving} className="w-full">
              {saving ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Timer className="mr-1 h-4 w-4" />
              )}
              Save Time Rules
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Crosshair className="h-4 w-4" />
              Test Current Location
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button onClick={handleTestLocation} disabled={testing} variant="outline" className="w-full">
              {testing ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-1 h-4 w-4" />
              )}
              Test GPS Location
            </Button>

            {testLat != null && testLng != null && (
              <div className="space-y-1.5 rounded-md border bg-muted/50 p-3 text-xs">
                <p className="flex items-center gap-1.5">
                  <MapPin className="h-3 w-3 text-muted-foreground" />
                  <span className="font-medium">Your Position:</span>
                </p>
                <p className="pl-5 text-muted-foreground">
                  Lat: {testLat.toFixed(6)}, Lng: {testLng.toFixed(6)}
                </p>
                {testDist != null && (
                  <p className="pl-5 text-muted-foreground">
                    Distance from school: <span className="font-medium">{testDist}m</span>
                  </p>
                )}
                <p className="pl-5 text-muted-foreground">
                  School: {settings.latitude?.toFixed(4) ?? 'N/A'}, {settings.longitude?.toFixed(4) ?? 'N/A'}
                </p>
                {testMsg && (
                  <p
                    className={`mt-1 pl-5 font-medium ${
                      testDist != null && testDist <= (settings.allowed_radius_meters ?? 100)
                        ? 'text-emerald-600'
                        : 'text-red-600'
                    }`}
                  >
                    {testMsg}
                  </p>
                )}
              </div>
            )}

            {testing && (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {!testLat && !testing && (
              <p className="text-center text-xs text-muted-foreground">
                Click "Test GPS Location" to verify your current position
                against the school geofence.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Monitor className="h-4 w-4" />
            Detected Device & Browser
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Smartphone className="h-4 w-4" />
              Device: <span className="font-medium text-foreground">{deviceInfo.device}</span>
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Globe className="h-4 w-4" />
              Browser: <span className="font-medium text-foreground">{deviceInfo.browser}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MapPin className="h-4 w-4" />
            Recent Attendance with GPS Data
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingAttendance ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : attendanceWithGps.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground">
              No attendance records with GPS data yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="px-2 py-1.5 text-left">Date</th>
                    <th className="px-2 py-1.5 text-left">Check In</th>
                    <th className="px-2 py-1.5 text-right">Distance</th>
                    <th className="px-2 py-1.5 text-center">Status</th>
                    <th className="px-2 py-1.5 text-left">Device</th>
                    <th className="px-2 py-1.5 text-left">Browser</th>
                    <th className="px-2 py-1.5 text-right">Accuracy</th>
                  </tr>
                </thead>
                <tbody>
                  {attendanceWithGps.map((rec: any) => (
                    <tr key={rec.id} className="border-b last:border-0 hover:bg-muted/50">
                      <td className="px-2 py-1.5">{rec.attendance_date}</td>
                      <td className="px-2 py-1.5">
                        {rec.check_in
                          ? new Date(rec.check_in).toLocaleTimeString('en-US', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : '-'}
                      </td>
                      <td className="px-2 py-1.5 text-right font-medium">
                        {rec.distance_from_school != null ? `${rec.distance_from_school}m` : '-'}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <Badge
                          variant={
                            rec.location_status === 'inside_school' ? 'success' : 'destructive'
                          }
                        >
                          {rec.location_status === 'inside_school' ? 'Inside' : 'Outside'}
                        </Badge>
                      </td>
                      <td className="px-2 py-1.5">{rec.device ?? '-'}</td>
                      <td className="px-2 py-1.5">{rec.browser ?? '-'}</td>
                      <td className="px-2 py-1.5 text-right">
                        {rec.gps_accuracy != null ? `±${rec.gps_accuracy}m` : '-'}
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
