-- ============================================
-- JK Attendance - Migration 00057
-- Fix: Restore attendance_status in check_in_with_location
-- ============================================
-- WHY:
--   Migration 00041 (search_path hardening) rewrote check_in_with_location
--   but dropped the attendance_status / check_in_time logic from migration
--   00038. Migration 00056 carried the regression forward.
--
--   Result: attendance_status is always NULL after check-in. The teacher
--   dashboard always falls back to the legacy `status` column (which uses
--   per-teacher reporting_time, not school-wide settings).
--
-- FIX:
--   1. Recompute attendance_status using school_settings.reporting_start_time
--      + grace_period_minutes (the authoritative source).
--   2. Compute late_minutes against the grace period end (consistent with
--      attendance_status).
--   3. Store check_in_time so undo_check_out and compute_attendance_status
--      can reference it.
--   4. Restore the ownership guard (is_teacher_owner / is_admin).
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
  v_attendance_status TEXT := 'PRESENT';
  v_location_status TEXT := 'inside_school';
  v_reporting_time TIME;
  v_late_minutes INTEGER := 0;
  v_grace_end TIME;
  v_existing_record RECORD;
  v_row RECORD;
  v_attempt_count INTEGER;
  v_window_start TIMESTAMPTZ := v_now - INTERVAL '5 minutes';
  v_oldest_attempt TIMESTAMPTZ;
  v_retry_after_seconds INTEGER;
BEGIN
  -- ========================================
  -- OWNERSHIP CHECK
  -- ========================================
  IF NOT (public.is_teacher_owner(p_teacher_id) OR public.is_admin()) THEN
    RAISE EXCEPTION 'Access denied: you can only check in as yourself'
      USING ERRCODE = '42501';
  END IF;

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
  -- LOG THIS ATTEMPT
  -- ========================================
  INSERT INTO public.rate_limit_checkins (teacher_id, attempt_time)
  VALUES (p_teacher_id, v_now);

  IF FLOOR(RANDOM() * 100) = 0 THEN
    PERFORM public.cleanup_rate_limit_checkins();
  END IF;

  -- ========================================
  -- LOAD SCHOOL SETTINGS
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

  -- ========================================
  -- GPS ACCURACY CHECK
  -- ========================================
  IF p_accuracy IS NOT NULL AND p_accuracy > 50 THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'rejected',
      'location_status', 'low_accuracy',
      'accuracy', ROUND(p_accuracy::numeric, 0),
      'message', 'GPS signal too weak. Accuracy must be within 50 meters.'
    );
  END IF;

  -- ========================================
  -- HAVERSINE DISTANCE
  -- ========================================
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

  -- ========================================
  -- DUPLICATE CHECK
  -- ========================================
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

  -- ========================================
  -- LEGACY STATUS (per-teacher reporting_time, backward compatible)
  -- ========================================
  SELECT COALESCE(reporting_time, '07:20'::TIME) INTO v_reporting_time
  FROM teachers
  WHERE id = p_teacher_id;

  IF v_now::TIME > v_reporting_time THEN
    v_status := 'late';
  END IF;

  -- ========================================
  -- ATTENDANCE STATUS (school-wide settings)
  -- ========================================
  v_grace_end := v_settings.reporting_start_time
    + (COALESCE(v_settings.grace_period_minutes, 20) || ' minutes')::INTERVAL;

  IF v_now::TIME > v_grace_end THEN
    v_attendance_status := 'LATE';
    v_late_minutes := EXTRACT(EPOCH FROM (v_now::TIME - v_grace_end)) / 60;
  ELSE
    v_attendance_status := 'PRESENT';
  END IF;

  -- ========================================
  -- INSERT ATTENDANCE RECORD
  -- ========================================
  INSERT INTO attendance (
    teacher_id, attendance_date, check_in, check_in_time,
    status, attendance_status, late_minutes,
    latitude, longitude,
    teacher_latitude, teacher_longitude,
    school_latitude, school_longitude,
    distance_from_school, location_status,
    device, browser, gps_accuracy
  )
  VALUES (
    p_teacher_id, v_today, v_now, v_now::TIME,
    v_status, v_attendance_status, v_late_minutes,
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
  'Rate limited: 5 attempts per 5 min window. Uses school-wide reporting_start_time + grace_period_minutes for attendance_status.';

-- Restore EXECUTE grants (DROP+CREATE resets to defaults)
REVOKE EXECUTE ON FUNCTION public.check_in_with_location(UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, DOUBLE PRECISION) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_in_with_location(UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, DOUBLE PRECISION) FROM anon;
GRANT   EXECUTE ON FUNCTION public.check_in_with_location(UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, DOUBLE PRECISION) TO authenticated;
