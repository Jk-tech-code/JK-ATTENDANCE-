import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/services/supabase'

// ─── Query keys ──────────────────────────────────────────────
export const schoolSettingsKeys = {
  all: ['school-settings'] as const,
  settings: () => [...schoolSettingsKeys.all, 'settings'] as const,
  gpsRecords: () => [...schoolSettingsKeys.all, 'gps-records'] as const,
}

// ─── Types ───────────────────────────────────────────────────
export interface SchoolSettingsFormData {
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

export interface AttendanceGpsRecord {
  id: string
  teacher_id: string
  attendance_date: string
  check_in: string | null
  teacher_latitude: number | null
  teacher_longitude: number | null
  distance_from_school: number | null
  location_status: string | null
  device: string | null
  browser: string | null
  gps_accuracy: number | null
}

// ─── Read: school settings ───────────────────────────────────
async function fetchSchoolSettings(): Promise<SchoolSettingsFormData | null> {
  const { data, error } = await supabase
    .from('school_settings')
    .select('*')
    .limit(1)
    .single()

  if (error) return null
  return data as SchoolSettingsFormData
}

export function useSchoolSettings() {
  return useQuery({
    queryKey: schoolSettingsKeys.settings(),
    queryFn: fetchSchoolSettings,
    staleTime: 60_000,
  })
}

// ─── Read: recent GPS attendance records ─────────────────────
async function fetchAttendanceGpsRecords(): Promise<AttendanceGpsRecord[]> {
  const { data, error } = await supabase
    .from('attendance')
    .select(
      'id, teacher_id, attendance_date, check_in, teacher_latitude, teacher_longitude, distance_from_school, location_status, device, browser, gps_accuracy',
    )
    .not('teacher_latitude', 'is', null)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) return []
  return (data ?? []) as AttendanceGpsRecord[]
}

export function useAttendanceGpsRecords() {
  return useQuery({
    queryKey: schoolSettingsKeys.gpsRecords(),
    queryFn: fetchAttendanceGpsRecords,
    staleTime: 30_000,
  })
}

// ─── Update: school settings ─────────────────────────────────
export function useUpdateSchoolSettings() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: Partial<SchoolSettingsFormData>) => {
      const id = input.id ?? (await fetchSchoolSettings())?.id
      if (!id) throw new Error('No school settings record found')

      const { error } = await supabase
        .from('school_settings')
        .update({
          school_name: input.school_name,
          latitude: input.latitude,
          longitude: input.longitude,
          allowed_radius_meters: input.allowed_radius_meters,
          active: input.active,
          reporting_start_time: input.reporting_start_time,
          grace_period_minutes: input.grace_period_minutes,
          checkout_time: input.checkout_time,
        })
        .eq('id', id)

      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: schoolSettingsKeys.all })
    },
  })
}
