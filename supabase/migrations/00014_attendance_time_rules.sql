-- ============================================
-- JK Attendance - Migration 00014
-- Attendance Time Rules & Automatic Status
-- Adds: check_in_time, check_out_time,
--       attendance_status, early_departure_minutes,
--       working_hours to attendance table.
-- Adds: reporting_start_time, grace_period_minutes,
--       checkout_time, weekend_working_days to school_settings.
-- Updates RPCs for automatic status calculation.
-- ============================================

-- ============================================
-- 1. ADD COLUMNS TO attendance
-- ============================================
ALTER TABLE attendance
ADD COLUMN IF NOT EXISTS check_in_time TIME,
ADD COLUMN IF NOT EXISTS check_out_time TIME,
ADD COLUMN IF NOT EXISTS attendance_status TEXT,
ADD COLUMN IF NOT EXISTS early_departure_minutes INTEGER,
ADD COLUMN IF NOT EXISTS working_hours TEXT;

-- ============================================
-- 2. ADD COLUMNS TO school_settings
-- ============================================
ALTER TABLE school_settings
ADD COLUMN IF NOT EXISTS reporting_start_time TIME DEFAULT '07:00',
ADD COLUMN IF NOT EXISTS grace_period_minutes INTEGER DEFAULT 20,
ADD COLUMN IF NOT EXISTS checkout_time TIME DEFAULT '17:30',
ADD COLUMN IF NOT EXISTS weekend_working_days TEXT DEFAULT '[]';

-- Seed settings if they are null for existing row
UPDATE school_settings
SET
  reporting_start_time = COALESCE(reporting_start_time, '07:00'::TIME),
  grace_period_minutes = COALESCE(grace_period_minutes, 20),
  checkout_time = COALESCE(checkout_time, '17:30'::TIME),
  weekend_working_days = COALESCE(weekend_working_days, '[]')
WHERE reporting_start_time IS NULL
   OR grace_period_minutes IS NULL
   OR checkout_time IS NULL
   OR weekend_working_days IS NULL;

-- ============================================
-- 3. COMPUTE ATTENDANCE STATUS FUNCTION
-- Returns attendance_status based on time rules.
-- ============================================
CREATE OR REPLACE FUNCTION compute_attendance_status(
  p_check_in_time TIME,
  p_check_out_time TIME,
  p_reporting_start TIME DEFAULT '07:00',
  p_grace_minutes INTEGER DEFAULT 20,
  p_checkout_time TIME DEFAULT '17:30'
) RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_grace_end TIME;
  v_status TEXT;
BEGIN
  -- No check-in = ABSENT
  IF p_check_in_time IS NULL THEN
    RETURN 'ABSENT';
  END IF;

  v_grace_end := p_reporting_start + (p_grace_minutes || ' minutes')::INTERVAL;

  -- Determine primary status based on check-in time
  IF p_check_in_time > v_grace_end THEN
    v_status := 'LATE';
  ELSE
    v_status := 'PRESENT';
  END IF;

  -- Apply check-out rules
  IF p_check_out_time IS NOT NULL THEN
    IF p_check_out_time < p_checkout_time THEN
      v_status := 'EARLY_DEPARTURE';
    END IF;
  END IF;

  -- If no checkout yet and was on time, stays PRESENT
  -- If no checkout yet and was late, stays LATE

  RETURN v_status;
END;
$$;

-- ============================================
-- 4. COMPUTE LATE MINUTES FUNCTION
-- Returns minutes after grace period end.
-- ============================================
CREATE OR REPLACE FUNCTION compute_late_minutes(
  p_check_in_time TIME,
  p_reporting_start TIME DEFAULT '07:00',
  p_grace_minutes INTEGER DEFAULT 20
) RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_grace_end TIME;
BEGIN
  IF p_check_in_time IS NULL THEN
    RETURN 0;
  END IF;

  v_grace_end := p_reporting_start + (p_grace_minutes || ' minutes')::INTERVAL;

  IF p_check_in_time > v_grace_end THEN
    RETURN EXTRACT(EPOCH FROM (p_check_in_time - v_grace_end)) / 60;
  END IF;

  RETURN 0;
END;
$$;

-- ============================================
-- 5. COMPUTE EARLY DEPARTURE MINUTES FUNCTION
-- ============================================
CREATE OR REPLACE FUNCTION compute_early_departure_minutes(
  p_check_out_time TIME,
  p_checkout_time TIME DEFAULT '17:30'
) RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_check_out_time IS NULL OR p_check_out_time >= p_checkout_time THEN
    RETURN 0;
  END IF;

  RETURN EXTRACT(EPOCH FROM (p_checkout_time - p_check_out_time)) / 60;
END;
$$;

-- ============================================
-- 6. FORMAT WORKING HOURS FUNCTION
-- Returns "X hrs Y mins" string.
-- ============================================
CREATE OR REPLACE FUNCTION format_working_hours(
  p_check_in TIMESTAMPTZ,
  p_check_out TIMESTAMPTZ
) RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_minutes INTEGER;
  v_hrs INTEGER;
  v_mins INTEGER;
BEGIN
  IF p_check_in IS NULL OR p_check_out IS NULL THEN
    RETURN NULL;
  END IF;

  v_minutes := GREATEST(0, EXTRACT(EPOCH FROM (p_check_out - p_check_in)) / 60);
  v_hrs := v_minutes / 60;
  v_mins := v_minutes % 60;

  RETURN v_hrs || ' hrs ' || v_mins || ' mins';
END;
$$;

-- ============================================
-- 7. UPDATE check_in_with_location RPC
-- Now populates check_in_time, attendance_status
-- ============================================
CREATE OR REPLACE FUNCTION check_in_with_location(
  p_teacher_id UUID,
  p_latitude DOUBLE PRECISION,
  p_longitude DOUBLE PRECISION,
  p_device TEXT,
  p_browser TEXT,
  p_accuracy DOUBLE PRECISION
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_settings RECORD;
  v_distance DOUBLE PRECISION;
  v_today DATE := CURRENT_DATE;
  v_now TIMESTAMPTZ := NOW();
  v_status TEXT := 'present';
  v_attendance_status TEXT;
  v_location_status TEXT := 'inside_school';
  v_reporting_time TIME;
  v_grace_end TIME;
  v_late_minutes INTEGER := 0;
  v_existing_record RECORD;
  v_row RECORD;
BEGIN
  SELECT * INTO v_settings
  FROM school_settings
  WHERE active = TRUE
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No active school settings configured. Contact administrator.'
    );
  END IF;

  IF p_accuracy IS NOT NULL AND p_accuracy > 50 THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'rejected',
      'location_status', 'low_accuracy',
      'accuracy', ROUND(p_accuracy::numeric, 0),
      'message', 'GPS signal too weak. Accuracy must be within 50 meters.'
    );
  END IF;

  v_distance := 6371000 * 2 * ASIN(
    SQRT(
      SIN(RADIANS(v_settings.latitude - p_latitude) / 2)^2 +
      COS(RADIANS(v_settings.latitude)) * COS(RADIANS(p_latitude)) *
      SIN(RADIANS(v_settings.longitude - p_longitude) / 2)^2
    )
  );

  IF v_distance > v_settings.allowed_radius_meters THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'rejected',
      'location_status', 'outside_school',
      'distance', ROUND(v_distance::numeric, 0),
      'message', 'You are outside the approved school attendance zone.'
    );
  END IF;

  SELECT * INTO v_existing_record
  FROM attendance
  WHERE teacher_id = p_teacher_id AND attendance_date = v_today;

  IF FOUND THEN
    IF v_existing_record.check_in IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'already_checked_in'
      );
    END IF;
  END IF;

  -- Legacy status (backward compatible)
  SELECT COALESCE(reporting_time, '07:20'::TIME) INTO v_reporting_time
  FROM teachers
  WHERE id = p_teacher_id;

  IF v_now::TIME > v_reporting_time THEN
    v_late_minutes := EXTRACT(EPOCH FROM (v_now::TIME - v_reporting_time)) / 60;
    v_status := 'late';
  END IF;

  -- New attendance status based on school settings
  v_grace_end := v_settings.reporting_start_time + (v_settings.grace_period_minutes || ' minutes')::INTERVAL;
  v_attendance_status := CASE WHEN v_now::TIME > v_grace_end THEN 'LATE' ELSE 'PRESENT' END;

  INSERT INTO attendance (
    teacher_id, attendance_date, check_in, check_in_time, status, attendance_status, late_minutes,
    latitude, longitude,
    teacher_latitude, teacher_longitude,
    school_latitude, school_longitude,
    distance_from_school, location_status,
    device, browser, gps_accuracy
  )
  VALUES (
    p_teacher_id, v_today, v_now, v_now::TIME, v_status, v_attendance_status, v_late_minutes,
    p_latitude, p_longitude,
    p_latitude, p_longitude,
    v_settings.latitude, v_settings.longitude,
    ROUND(v_distance::numeric, 0), v_location_status,
    p_device, p_browser, p_accuracy
  )
  ON CONFLICT (teacher_id, attendance_date)
  DO UPDATE SET
    check_in = v_now,
    check_in_time = v_now::TIME,
    status = v_status,
    attendance_status = v_attendance_status,
    late_minutes = v_late_minutes,
    latitude = p_latitude,
    longitude = p_longitude,
    teacher_latitude = p_latitude,
    teacher_longitude = p_longitude,
    school_latitude = v_settings.latitude,
    school_longitude = v_settings.longitude,
    distance_from_school = ROUND(v_distance::numeric, 0),
    location_status = v_location_status,
    device = p_device,
    browser = p_browser,
    gps_accuracy = p_accuracy
  WHERE attendance.check_in IS NULL
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'already_checked_in'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'status', v_status,
    'attendance_status', v_attendance_status,
    'location_status', v_location_status,
    'distance', ROUND(v_distance::numeric, 0),
    'id', v_row.id
  );
END;
$$;

-- ============================================
-- 8. UPDATE check_out RPC
-- Populates check_out_time, early_departure_minutes,
-- working_hours, attendance_status (COMPLETE_DAY / EARLY_DEPARTURE)
-- ============================================
CREATE OR REPLACE FUNCTION check_out(p_attendance_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row RECORD;
  v_now TIMESTAMPTZ := NOW();
  v_settings RECORD;
  v_attendance_status TEXT;
  v_early_departure_minutes INTEGER := 0;
  v_checkout_time TIME;
BEGIN
  SELECT * INTO v_row FROM attendance WHERE id = p_attendance_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  IF v_row.check_in IS NULL THEN
    RETURN jsonb_build_object('error', 'not_checked_in');
  END IF;

  IF v_row.check_out IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'already_checked_out');
  END IF;

  -- Get school settings for checkout time
  SELECT * INTO v_settings
  FROM school_settings
  WHERE active = TRUE
  LIMIT 1;

  v_checkout_time := COALESCE(v_settings.checkout_time, '17:30'::TIME);
  v_early_departure_minutes := 0;

  -- Calculate early departure
  IF v_now::TIME < v_checkout_time THEN
    v_early_departure_minutes := EXTRACT(EPOCH FROM (v_checkout_time - v_now::TIME)) / 60;
    v_attendance_status := 'EARLY_DEPARTURE';
  ELSE
    v_attendance_status := 'COMPLETE_DAY';
  END IF;

  UPDATE attendance
  SET
    check_out = v_now,
    check_out_time = v_now::TIME,
    working_minutes = GREATEST(0, EXTRACT(EPOCH FROM (v_now - v_row.check_in)) / 60),
    working_hours = format_working_hours(v_row.check_in, v_now),
    status = 'checked_out',
    attendance_status = v_attendance_status,
    early_departure_minutes = v_early_departure_minutes,
    check_out_expires_at = v_now + INTERVAL '30 seconds'
  WHERE id = p_attendance_id
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;

-- ============================================
-- 9. UPDATE undo_check_out RPC
-- Resets attendance_status based on check-in time
-- ============================================
CREATE OR REPLACE FUNCTION undo_check_out(p_attendance_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row RECORD;
  v_now TIMESTAMPTZ := NOW();
  v_settings RECORD;
  v_grace_end TIME;
BEGIN
  SELECT * INTO v_row FROM attendance WHERE id = p_attendance_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  IF v_row.check_out IS NULL THEN
    RETURN jsonb_build_object('error', 'not_checked_out');
  END IF;

  IF v_now > v_row.check_out_expires_at THEN
    RETURN jsonb_build_object('error', 'undo_window_expired');
  END IF;

  -- Get school settings to recompute attendance_status
  SELECT * INTO v_settings
  FROM school_settings
  WHERE active = TRUE
  LIMIT 1;

  v_grace_end := v_settings.reporting_start_time + (v_settings.grace_period_minutes || ' minutes')::INTERVAL;

  UPDATE attendance
  SET
    check_out = NULL,
    check_out_time = NULL,
    working_minutes = NULL,
    working_hours = NULL,
    status = CASE WHEN COALESCE(v_row.late_minutes, 0) > 0 THEN 'late' ELSE 'present' END,
    attendance_status = CASE WHEN v_row.check_in_time IS NOT NULL AND v_row.check_in_time > v_grace_end THEN 'LATE' ELSE 'PRESENT' END,
    early_departure_minutes = NULL,
    check_out_expires_at = NULL
  WHERE id = p_attendance_id
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;

-- ============================================
-- 10. UPDATE process_end_of_day RPC
-- Populates new fields for auto-checkouts and absences
-- ============================================
CREATE OR REPLACE FUNCTION process_end_of_day()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_today DATE := CURRENT_DATE;
  v_end_of_day TIMESTAMPTZ := (CURRENT_DATE + INTERVAL '1 day' - INTERVAL '1 second');
  v_is_holiday BOOLEAN;
  v_settings RECORD;
BEGIN
  SELECT EXISTS(SELECT 1 FROM school_holidays WHERE date = v_today) INTO v_is_holiday;

  IF v_is_holiday THEN
    RETURN;
  END IF;

  -- Get school settings
  SELECT * INTO v_settings
  FROM school_settings
  WHERE active = TRUE
  LIMIT 1;

  -- Batch auto check-out for those still checked in
  UPDATE attendance a
  SET
    check_out = v_end_of_day,
    check_out_time = '23:59:59'::TIME,
    working_minutes = GREATEST(0, EXTRACT(EPOCH FROM (v_end_of_day - a.check_in)) / 60),
    working_hours = format_working_hours(a.check_in, v_end_of_day),
    status = 'checked_out',
    attendance_status = compute_attendance_status(
      a.check_in_time,
      '23:59:59'::TIME,
      v_settings.reporting_start_time,
      v_settings.grace_period_minutes,
      v_settings.checkout_time
    ),
    early_departure_minutes = 0
  WHERE a.attendance_date = v_today
    AND a.check_in IS NOT NULL
    AND a.check_out IS NULL;

  -- Batch absent insertion with attendance_status = 'ABSENT'
  INSERT INTO attendance (teacher_id, attendance_date, status, attendance_status)
  SELECT t.id, v_today, 'absent', 'ABSENT'
  FROM teachers t
  WHERE t.employment_status = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM attendance a
      WHERE a.teacher_id = t.id AND a.attendance_date = v_today
    );
END;
$$;

-- ============================================
-- 11. UPDATE get_admin_dashboard_stats RPC
-- Includes early_departure_today count
-- ============================================
CREATE OR REPLACE FUNCTION get_admin_dashboard_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_today DATE := CURRENT_DATE;
  v_total_teachers INTEGER;
  v_present_today INTEGER;
  v_late_today INTEGER;
  v_absent_today INTEGER;
  v_checked_out_today INTEGER;
  v_in_school_now INTEGER;
  v_early_departure_today INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_total_teachers
  FROM teachers
  WHERE employment_status = 'active';

  SELECT COUNT(*) INTO v_present_today
  FROM attendance
  WHERE attendance_date = v_today AND status = 'present';

  SELECT COUNT(*) INTO v_late_today
  FROM attendance
  WHERE attendance_date = v_today AND status = 'late';

  SELECT COUNT(*) INTO v_absent_today
  FROM attendance
  WHERE attendance_date = v_today AND status = 'absent';

  SELECT COUNT(*) INTO v_checked_out_today
  FROM attendance
  WHERE attendance_date = v_today AND status = 'checked_out';

  SELECT COUNT(*) INTO v_in_school_now
  FROM attendance
  WHERE attendance_date = v_today AND check_in IS NOT NULL AND check_out IS NULL;

  SELECT COUNT(*) INTO v_early_departure_today
  FROM attendance
  WHERE attendance_date = v_today AND attendance_status = 'EARLY_DEPARTURE';

  RETURN jsonb_build_object(
    'total_teachers', v_total_teachers,
    'present_today', v_present_today,
    'late_today', v_late_today,
    'absent_today', v_absent_today,
    'checked_out_today', v_checked_out_today,
    'in_school_now', v_in_school_now,
    'early_departure_today', v_early_departure_today
  );
END;
$$;

-- ============================================
-- 12. UPDATE get_daily_report RPC
-- Includes early departure and working hours
-- ============================================
CREATE OR REPLACE FUNCTION get_daily_report(p_date DATE DEFAULT CURRENT_DATE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_present INTEGER;
  v_late INTEGER;
  v_absent INTEGER;
  v_early_departure INTEGER;
  v_total INTEGER;
  v_avg_check_in TEXT;
  v_avg_working_minutes NUMERIC;
  v_attendance_rate NUMERIC;
BEGIN
  SELECT COUNT(*) INTO v_present FROM attendance WHERE attendance_date = p_date AND status IN ('present', 'checked_out');
  SELECT COUNT(*) INTO v_late FROM attendance WHERE attendance_date = p_date AND status IN ('late', 'checked_out') AND late_minutes > 0;
  SELECT COUNT(*) INTO v_absent FROM attendance WHERE attendance_date = p_date AND status = 'absent';
  SELECT COUNT(*) INTO v_early_departure FROM attendance WHERE attendance_date = p_date AND attendance_status = 'EARLY_DEPARTURE';
  SELECT COUNT(*) INTO v_total FROM teachers WHERE employment_status = 'active';

  SELECT TO_CHAR(AVG(check_in::TIME), 'HH24:MI') INTO v_avg_check_in
  FROM attendance
  WHERE attendance_date = p_date AND check_in IS NOT NULL;

  SELECT ROUND(AVG(working_minutes)) INTO v_avg_working_minutes
  FROM attendance
  WHERE attendance_date = p_date AND working_minutes IS NOT NULL;

  v_attendance_rate := CASE WHEN v_total > 0 THEN ROUND((v_present + v_late)::NUMERIC / v_total * 100) ELSE 0 END;

  RETURN jsonb_build_object(
    'date', p_date,
    'present', v_present,
    'late', v_late,
    'absent', v_absent,
    'early_departure', v_early_departure,
    'total_teachers', v_total,
    'attendance_rate', v_attendance_rate,
    'avg_check_in_time', COALESCE(v_avg_check_in, '-'),
    'avg_working_minutes', COALESCE(v_avg_working_minutes, 0)
  );
END;
$$;

-- ============================================
-- 13. UPDATE get_monthly_report RPC
-- ============================================
CREATE OR REPLACE FUNCTION get_monthly_report(p_year INTEGER, p_month INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_days INTEGER;
  v_present_days INTEGER;
  v_late_days INTEGER;
  v_absent_days INTEGER;
  v_early_departure_days INTEGER;
  v_attendance_pct NUMERIC;
  v_avg_working NUMERIC;
  v_total_teachers INTEGER;
  v_start_date DATE;
  v_end_date DATE;
  v_result JSONB;
BEGIN
  v_start_date := make_date(p_year, p_month, 1);
  v_end_date := (v_start_date + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

  SELECT COUNT(*) INTO v_total_teachers FROM teachers WHERE employment_status = 'active';

  SELECT
    COUNT(*) FILTER (WHERE status IN ('present', 'checked_out')),
    COUNT(*) FILTER (WHERE status = 'late' OR (status IN ('present', 'checked_out') AND late_minutes > 0)),
    COUNT(*) FILTER (WHERE status = 'absent'),
    COUNT(*) FILTER (WHERE attendance_status = 'EARLY_DEPARTURE'),
    ROUND(AVG(working_minutes))
  INTO v_present_days, v_late_days, v_absent_days, v_early_departure_days, v_avg_working
  FROM attendance
  WHERE attendance_date BETWEEN v_start_date AND v_end_date;

  v_attendance_pct := CASE WHEN v_total_teachers > 0
    THEN ROUND((v_present_days + v_late_days)::NUMERIC / (v_total_teachers * EXTRACT(DAY FROM v_end_date)) * 100)
    ELSE 0 END;

  RETURN jsonb_build_object(
    'year', p_year, 'month', p_month,
    'total_teachers', v_total_teachers,
    'present_days', v_present_days,
    'late_days', v_late_days,
    'absent_days', v_absent_days,
    'early_departure_days', v_early_departure_days,
    'attendance_percentage', v_attendance_pct,
    'avg_working_minutes', COALESCE(v_avg_working, 0)
  );
END;
$$;
