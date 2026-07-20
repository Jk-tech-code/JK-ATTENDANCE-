-- ============================================
-- JK Attendance - Migration 00016
-- Rate limiting for check-in/check-out + cleanup
-- ============================================

-- ============================================
-- 1. RATE LIMITING FUNCTION
-- ============================================

CREATE OR REPLACE FUNCTION check_rate_limit(
  p_teacher_id UUID,
  p_cooldown_seconds INTEGER DEFAULT 60
)
RETURNS TABLE(allowed BOOLEAN, remaining_seconds INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH last_check AS (
    SELECT check_in, check_out
    FROM attendance
    WHERE teacher_id = p_teacher_id
      AND attendance_date = CURRENT_DATE
    ORDER BY created_at DESC
    LIMIT 1
  )
  SELECT
    CASE
      WHEN last_check.check_in IS NULL THEN TRUE
      WHEN last_check.check_out IS NOT NULL THEN TRUE
      WHEN EXTRACT(EPOCH FROM (NOW() - last_check.check_in)) >= p_cooldown_seconds THEN TRUE
      ELSE FALSE
    END AS allowed,
    CASE
      WHEN last_check.check_in IS NULL THEN 0
      WHEN last_check.check_out IS NOT NULL THEN 0
      ELSE GREATEST(0, p_cooldown_seconds - EXTRACT(EPOCH FROM (NOW() - last_check.check_in))::INTEGER)
    END AS remaining_seconds
  FROM last_check;
END;
$$;

-- ============================================
-- 2. UPDATE CHECK_IN RPC WITH RATE LIMITING
-- ============================================

CREATE OR REPLACE FUNCTION check_in_with_location(
  p_teacher_id UUID,
  p_latitude DECIMAL,
  p_longitude DECIMAL,
  p_device TEXT DEFAULT NULL,
  p_browser TEXT DEFAULT NULL,
  p_accuracy DECIMAL DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_settings RECORD;
  v_distance DECIMAL;
  v_location_status TEXT;
  v_status TEXT;
  v_late_minutes INTEGER;
  v_today DATE := CURRENT_DATE;
  v_rate_limit RECORD;
  v_existing_id UUID;
BEGIN
  -- Rate limit: prevent check-in more than once per 60 seconds
  SELECT allowed, remaining_seconds INTO v_rate_limit
  FROM check_rate_limit(p_teacher_id, 60);

  IF NOT v_rate_limit.allowed THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Please wait %s seconds before checking in again', v_rate_limit.remaining_seconds),
      'retry_after', v_rate_limit.remaining_seconds
    );
  END IF;

  -- Fetch school settings
  SELECT * INTO v_settings
  FROM school_settings
  LIMIT 1;

  IF v_settings.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'School settings not configured');
  END IF;

  -- Calculate distance using Haversine
  v_distance := 6371000 * 2 * ASIN(SQRT(
    POWER(SIN(RADIANS(p_latitude - v_settings.latitude) / 2), 2) +
    COS(RADIANS(v_settings.latitude)) * COS(RADIANS(p_latitude)) *
    POWER(SIN(RADIANS(p_longitude - v_settings.longitude) / 2), 2)
  ));

  -- Determine location status
  IF p_accuracy IS NOT NULL AND p_accuracy > 50 THEN
    v_location_status := 'low_accuracy';
  ELSIF v_distance <= COALESCE(v_settings.allowed_radius_meters, 100) THEN
    v_location_status := 'inside_school';
  ELSE
    v_location_status := 'outside_school';
  END IF;

  -- Only proceed if inside school with good accuracy
  IF v_location_status = 'low_accuracy' THEN
    RETURN jsonb_build_object(
      'success', false, 'location_status', 'low_accuracy',
      'distance', ROUND(v_distance)::INTEGER,
      'accuracy', p_accuracy
    );
  END IF;

  IF v_location_status = 'outside_school' THEN
    RETURN jsonb_build_object(
      'success', false, 'location_status', 'outside_school',
      'distance', ROUND(v_distance)::INTEGER,
      'error', format('You are %s meters away from school. Must be within %s meters.', ROUND(v_distance)::INTEGER, COALESCE(v_settings.allowed_radius_meters, 100))
    );
  END IF;

  -- Determine late status
  IF CURRENT_TIME > v_settings.grace_period_minutes::TEXT::TIME + v_settings.reporting_start_time THEN
    v_late_minutes := EXTRACT(EPOCH FROM (CURRENT_TIME - (v_settings.grace_period_minutes::TEXT::TIME + v_settings.reporting_start_time))) / 60;
    v_status := 'late';
  ELSE
    v_late_minutes := 0;
    v_status := 'present';
  END IF;

  -- Upsert attendance
  INSERT INTO attendance (
    teacher_id, attendance_date, check_in, check_in_time, status, attendance_status,
    late_minutes, latitude, longitude, device, browser, gps_accuracy,
    distance_from_school, location_status,
    school_latitude, school_longitude, teacher_latitude, teacher_longitude
  ) VALUES (
    p_teacher_id, v_today, NOW(), CURRENT_TIME, v_status,
    CASE WHEN v_late_minutes > 0 THEN 'LATE' ELSE 'PRESENT' END,
    v_late_minutes, p_latitude, p_longitude, p_device, p_browser, p_accuracy,
    ROUND(v_distance)::INTEGER, v_location_status,
    v_settings.latitude, v_settings.longitude, p_latitude, p_longitude
  )
  ON CONFLICT (teacher_id, attendance_date) WHERE check_in IS NULL
  DO UPDATE SET
    check_in = NOW(), check_in_time = CURRENT_TIME,
    status = v_status, attendance_status = CASE WHEN v_late_minutes > 0 THEN 'LATE' ELSE 'PRESENT' END,
    late_minutes = v_late_minutes,
    latitude = p_latitude, longitude = p_longitude,
    device = p_device, browser = p_browser, gps_accuracy = p_accuracy,
    distance_from_school = ROUND(v_distance)::INTEGER, location_status = v_location_status,
    school_latitude = v_settings.latitude, school_longitude = v_settings.longitude,
    teacher_latitude = p_latitude, teacher_longitude = p_longitude
  RETURNING id INTO v_existing_id;

  IF v_existing_id IS NULL THEN
    SELECT id INTO v_existing_id
    FROM attendance
    WHERE teacher_id = p_teacher_id AND attendance_date = v_today;
  END IF;

  RETURN jsonb_build_object(
    'success', true, 'attendance_id', v_existing_id,
    'status', v_status, 'late_minutes', v_late_minutes,
    'distance', ROUND(v_distance)::INTEGER,
    'location_status', v_location_status,
    'accuracy', p_accuracy
  );
END;
$$;

-- ============================================
-- 3. UPDATE CHECK_OUT RPC WITH RATE LIMITING
-- ============================================

CREATE OR REPLACE FUNCTION check_out(
  p_attendance_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_record RECORD;
  v_working_minutes INTEGER;
  v_working_hours TEXT;
  v_early_departure INTEGER;
  v_settings RECORD;
  v_rate_limit RECORD;
BEGIN
  -- Fetch the attendance record
  SELECT * INTO v_record
  FROM attendance
  WHERE id = p_attendance_id AND check_out IS NULL;

  IF v_record.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No active check-in found for this record');
  END IF;

  -- Rate limit: prevent check-out within 5 seconds of check-in (accidental double-tap)
  SELECT allowed, remaining_seconds INTO v_rate_limit
  FROM check_rate_limit(v_record.teacher_id, 5);

  IF NOT v_rate_limit.allowed THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Please wait a moment before checking out',
      'retry_after', v_rate_limit.remaining_seconds
    );
  END IF;

  -- Calculate working minutes
  v_working_minutes := EXTRACT(EPOCH FROM (NOW() - v_record.check_in)) / 60;
  v_working_hours := floor(v_working_minutes / 60) || ' hrs ' || (v_working_minutes % 60) || ' mins';

  -- Fetch school settings for early departure check
  SELECT * INTO v_settings FROM school_settings LIMIT 1;

  v_early_departure := 0;
  IF v_settings.id IS NOT NULL AND CURRENT_TIME < v_settings.checkout_time THEN
    v_early_departure := EXTRACT(EPOCH FROM (v_settings.checkout_time - CURRENT_TIME)) / 60;
  END IF;

  -- Update the record
  UPDATE attendance SET
    check_out = NOW(),
    check_out_time = CURRENT_TIME,
    check_out_expires_at = NOW() + INTERVAL '30 seconds',
    working_minutes = v_working_minutes,
    working_hours = v_working_hours,
    early_departure_minutes = CASE WHEN v_early_departure > 0 THEN v_early_departure ELSE NULL END,
    attendance_status = CASE
      WHEN v_early_departure > 0 THEN 'EARLY_DEPARTURE'
      WHEN v_record.late_minutes > 0 THEN 'COMPLETE_DAY'
      ELSE 'COMPLETE_DAY'
    END,
    status = 'checked_out'
  WHERE id = p_attendance_id;

  RETURN jsonb_build_object(
    'success', true,
    'working_minutes', v_working_minutes,
    'working_hours', v_working_hours,
    'early_departure_minutes', v_early_departure
  );
END;
$$;
