export interface Teacher {
  id: string
  staff_number: string
  full_name: string
  email: string
  department: string | null
  phone: string | null
  reporting_time: string | null
  employment_status: string | null
  created_at: string
}

export interface Attendance {
  id: string
  teacher_id: string
  attendance_date: string
  check_in: string | null
  check_in_time: string | null
  check_out: string | null
  check_out_time: string | null
  check_out_expires_at: string | null
  late_minutes: number | null
  early_departure_minutes: number | null
  working_minutes: number | null
  working_hours: string | null
  status: string | null
  attendance_status: string | null
  latitude: number | null
  longitude: number | null
  teacher_latitude: number | null
  teacher_longitude: number | null
  school_latitude: number | null
  school_longitude: number | null
  distance_from_school: number | null
  location_status: string | null
  gps_accuracy: number | null
  device: string | null
  browser: string | null
  ip_address: string | null
  created_at: string
}

export interface SchoolSettings {
  id: string
  school_name: string | null
  latitude: number | null
  longitude: number | null
  allowed_radius: number | null
  allowed_radius_meters: number | null
  default_reporting_time: string | null
  reporting_start_time: string | null
  grace_period_minutes: number | null
  checkout_time: string | null
  weekend_working_days: string | null
  active: boolean | null
  created_at: string | null
}

export interface SchoolHoliday {
  id: string
  date: string
  description: string
  created_at: string
}

export type AuthUser = {
  id: string
  email: string
  teacher: Teacher | null
  role?: string
}
