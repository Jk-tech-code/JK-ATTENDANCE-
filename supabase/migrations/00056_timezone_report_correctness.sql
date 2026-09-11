-- ============================================
-- JK Attendance - Migration 00056
-- Timezone & report correctness fixes (Phase 4B-4E)
-- ============================================
-- Fixes:
--   1. count_month_working_days() — correct monthly denominator
--   2. check_in_with_location() — Africa/Nairobi attendance date
--   3. process_end_of_day() — Africa/Nairobi business date
-- ============================================

-- ============================================
-- 1. FUNCTION: count_month_working_days(year, month)
-- Returns the number of working days in a month using the school_calendar
-- table. Falls back to DOW-based weekend detection (Sat/Sun) when no
-- calendar entry exists — same logic as get_month_calendar().
--
-- This replaces the broken `monthDays - holidays` which included weekends.
-- ============================================
CREATE OR REPLACE FUNCTION public.count_month_working_days(
  p_year INTEGER,
  p_month INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_start DATE;
  v_end   DATE;
  v_count INTEGER;
BEGIN
  v_start := make_date(p_year, p_month, 1);
  v_end   := (v_start + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

  SELECT COUNT(*) INTO v_count
  FROM generate_series(v_start, v_end, '1 day') AS d(day)
  LEFT JOIN school_calendar sc ON sc.calendar_date = d.day
  WHERE COALESCE(sc.day_type,
    CASE WHEN EXTRACT(DOW FROM d.day) IN (0, 6) THEN 'weekend' ELSE 'working_day' END
  ) = 'working_day';

  RETURN v_count;
END;
$$;

-- Grant: Edge Functions (service_role) and authenticated (admin UI) can call it
REVOKE  EXECUTE ON FUNCTION public.count_month_working_days(INTEGER, INTEGER) FROM PUBLIC;
REVOKE  EXECUTE ON FUNCTION public.count_month_working_days(INTEGER, INTEGER) FROM anon;
GRANT    EXECUTE ON FUNCTION public.count_month_working_days(INTEGER, INTEGER) TO service_role;
GRANT    EXECUTE ON FUNCTION public.count_month_working_days(INTEGER, INTEGER) TO authenticated;


-- ============================================
-- 2. FIX: check_in_with_location — Africa/Nairobi date
-- ============================================
-- Replaces CURRENT_DATE with timezone-aware date.
-- The function signature, SECURITY DEFINER, search_path, authorization,
-- geofence, rate limiting, and all other logic are preserved exactly.
-- ============================================
DROP FUNCTION IF EXISTS public.check_in_with_location(
  UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, DOUBLE PRECISION
);

CREATE OR REPLACE FUNCTION public.check_in_with_location(
  p_teacher_id UUID,
  p_latitude DOUBLE PRECISION,
  p_longitude DOUBLE PRECISION,
  p_device TEXT,
  p_browser TEXT,
  p_accuracy DOUBLE PRECISION
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_settings RECORD;
  v_distance DOUBLE PRECISION;
  v_today DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Nairobi')::date;
  v_now TIMESTAMPTZ := NOW();
  v_status TEXT := 'present';
  v_location_status TEXT := 'inside_school';
  v_reporting_time TIME;
  v_late_minutes INTEGER := 0;
  v_existing_record RECORD;
  v_row RECORD;
  v_attempt_count INTEGER;
  v_window_start TIMESTAMPTZ := v_now - INTERVAL '5 minutes';
  v_oldest_attempt TIMESTAMPTZ;
  v_retry_after_seconds INTEGER;
BEGIN
  -- ========================================
  -- RATE LIMIT CHECK (5 attempts per 5 minutes)
  -- ========================================
  SELECT COUNT(*) INTO v_attempt_count
  FROM public.rate_limit_checkins
  WHERE teacher_id = p_teacher_id
    AND attempt_time >= v_window_start;

  IF v_attempt_count >= 5 THEN
    SELECT attempt_time INTO v_oldest_attempt
    FROM public.rate_limit_checkins
    WHERE teacher_id = p_teacher_id
      AND attempt_time >= v_window_start
    ORDER BY attempt_time ASC
    LIMIT 1;

    v_retry_after_seconds := EXTRACT(EPOCH FROM (v_oldest_attempt + INTERVAL '5 minutes' - v_now))::INTEGER;

    RETURN jsonb_build_object(
      'success', false,
      'error', 'rate_limited',
      'message', 'Too many check-in attempts. Please wait before trying again.',
      'retry_after_seconds', GREATEST(v_retry_after_seconds, 1),
      'attempts_in_window', v_attempt_count,
      'max_attempts', 5,
      'window_minutes', 5
    );
  END IF;

  -- ========================================
  -- LOG THIS ATTEMPT (counts toward rate limit regardless of outcome)
  -- ========================================
  INSERT INTO public.rate_limit_checkins (teacher_id, attempt_time)
  VALUES (p_teacher_id, v_now);

  -- Cleanup old entries opportunistically (1% chance to avoid overhead)
  IF FLOOR(RANDOM() * 100) = 0 THEN
    PERFORM public.cleanup_rate_limit_checkins();
  END IF;

  -- ========================================
  -- EXISTING VALIDATION LOGIC
  -- ========================================
  SELECT * INTO v_settings
  FROM school_settings
  WHERE active = TRUE
  ORDER BY created_at DESC
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

  SELECT COALESCE(reporting_time, '07:20'::TIME) INTO v_reporting_time
  FROM teachers
  WHERE id = p_teacher_id;

  IF v_now::TIME > v_reporting_time THEN
    v_late_minutes := EXTRACT(EPOCH FROM (v_now::TIME - v_reporting_time)) / 60;
    v_status := 'late';
  END IF;

  INSERT INTO attendance (
    teacher_id, attendance_date, check_in, status, late_minutes,
    latitude, longitude,
    teacher_latitude, teacher_longitude,
    school_latitude, school_longitude,
    distance_from_school, location_status,
    device, browser, gps_accuracy
  )
  VALUES (
    p_teacher_id, v_today, v_now, v_status, v_late_minutes,
    p_latitude, p_longitude,
    p_latitude, p_longitude,
    v_settings.latitude, v_settings.longitude,
    ROUND(v_distance::numeric, 0), v_location_status,
    p_device, p_browser, p_accuracy
  )
  ON CONFLICT (teacher_id, attendance_date)
  DO UPDATE SET
    check_in = v_now,
    status = v_status,
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
    'location_status', v_location_status,
    'distance', ROUND(v_distance::numeric, 0),
    'allowed_radius_meters', v_settings.allowed_radius_meters,
    'id', v_row.id,
    'rate_limit', jsonb_build_object(
      'attempts_used', v_attempt_count + 1,
      'max_attempts', 5,
      'window_minutes', 5,
      'remaining', GREATEST(5 - (v_attempt_count + 1), 0)
    )
  );
END;
$$;

COMMENT ON FUNCTION public.check_in_with_location(UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, DOUBLE PRECISION) IS
  'Rate limited: 5 attempts per 5 min window. Attendance date uses Africa/Nairobi timezone.';

-- Restore EXECUTE grants (DROP+CREATE resets to defaults)
REVOKE EXECUTE ON FUNCTION public.check_in_with_location(UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, DOUBLE PRECISION) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_in_with_location(UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, DOUBLE PRECISION) FROM anon;
GRANT   EXECUTE ON FUNCTION public.check_in_with_location(UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, DOUBLE PRECISION) TO authenticated;


-- ============================================
-- 3. FIX: process_end_of_day — Africa/Nairobi date
-- ============================================
-- Uses (CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Nairobi')::date
-- to determine the business date instead of CURRENT_DATE.
-- ============================================
DROP FUNCTION IF EXISTS public.process_end_of_day();

CREATE OR REPLACE FUNCTION public.process_end_of_day()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_today DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Nairobi')::date;
  v_end_of_day TIMESTAMPTZ := (
    (CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Nairobi')::date
    + INTERVAL '1 day' - INTERVAL '1 second'
  ) AT TIME ZONE 'Africa/Nairobi';
  v_is_holiday BOOLEAN;
  v_settings RECORD;
  v_auto_checkouts INTEGER := 0;
  v_absents_inserted INTEGER := 0;
BEGIN
  -- Check if today is a holiday
  SELECT EXISTS(SELECT 1 FROM school_holidays WHERE date = v_today) INTO v_is_holiday;

  IF v_is_holiday THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'Holiday - no processing needed',
      'auto_checkouts', 0,
      'absents_inserted', 0
    );
  END IF;

  -- Get active school settings
  SELECT * INTO v_settings
  FROM school_settings
  WHERE active = TRUE
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No active school settings configured'
    );
  END IF;

  -- ========================================
  -- 1. AUTO CHECK-OUT (idempotent)
  -- ========================================
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

  GET DIAGNOSTICS v_auto_checkouts = ROW_COUNT;

  -- ========================================
  -- 2. INSERT ABSENT RECORDS (idempotent)
  -- ========================================
  INSERT INTO attendance (teacher_id, attendance_date, status, attendance_status)
  SELECT t.id, v_today, 'absent', 'ABSENT'
  FROM teachers t
  WHERE t.employment_status = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM attendance a
      WHERE a.teacher_id = t.id AND a.attendance_date = v_today
    )
  ON CONFLICT (teacher_id, attendance_date) DO NOTHING;

  GET DIAGNOSTICS v_absents_inserted = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'auto_checkouts', v_auto_checkouts,
    'absents_inserted', v_absents_inserted,
    'processed_date', v_today
  );
END;
$$;

-- Maintain existing grants
REVOKE EXECUTE ON FUNCTION public.process_end_of_day() FROM anon, authenticated;
GRANT   EXECUTE ON FUNCTION public.process_end_of_day() TO service_role;

COMMENT ON FUNCTION public.process_end_of_day() IS
  'End-of-day processing. Business date uses Africa/Nairobi timezone. Idempotent.';
