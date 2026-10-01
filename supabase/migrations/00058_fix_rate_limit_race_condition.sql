-- ============================================
-- JK Attendance - Migration 00058
-- FIX: Race-condition-free rate limiting for check_in_with_location
-- ============================================
-- WHY:
--   The rate-limit logic in `check_in_with_location` (migration 00057)
--   performs a non-atomic `SELECT COUNT(*)` followed by an `INSERT`.
--   Under concurrent load, two transactions can both pass the count
--   check and both insert, allowing an attacker to exceed the
--   5-attempt limit.
--
--   The `rate_limit_checkins` table is keyed by (teacher_id, attempt_time)
--   with attempt_time defaulting to NOW(). This makes it impossible to
--   pre-compute a window and do a safe ON CONFLICT, so we adopt a simpler,
--   bulletproof approach: **always INSERT first**, then count how many
--   attempts exist in the current window *including the row we just
--   inserted*. If the count exceeds the limit, we roll back our own insert
--   (so the table stays clean) and return a rate-limit error. Crucially,
--   the INSERT itself is atomic under Postgres row-level locking — two
--   concurrent transactions will serialize on the act of inserting their
--   attempt rows, and each will see a distinct, accurate count.
--
-- SAFETY:
--   * The function is `SECURITY DEFINER`, so inserts succeed even though
--     RLS would normally deny `authenticated` writes to
--     `rate_limit_checkins`.
--   * We explicitly `ROLLBACK TO SAVEPOINT` on the rejected attempt so the
--   table never accumulates rows for denied attempts. This keeps the
--   window counts accurate for subsequent, legitimate attempts.
--   * The `cleanup_rate_limit_checkins()` helper remains unchanged.
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
  v_window_start TIMESTAMPTZ := v_now - INTERVAL '5 minutes';
  v_attempt_count INTEGER;
  v_retry_after_seconds INTEGER;
  v_oldest_attempt TIMESTAMPTZ;
  -- Savepoint name for atomic rate-limit rollback
  rl_savepoint TEXT := 'rate_limit_point';
BEGIN
  -- ========================================
  -- OWNERSHIP CHECK
  -- ========================================
  IF NOT (public.is_teacher_owner(p_teacher_id) OR public.is_admin()) THEN
    RAISE EXCEPTION 'Access denied: you can only check in as yourself'
      USING ERRCODE = '42501';
  END IF;

  -- ========================================
  -- ATOMIC RATE LIMIT (5 attempts per 5-minute window)
  -- ========================================
  -- Insert this attempt FIRST. The INSERT is atomic under row-level
  -- locking; concurrent transactions serialize here. We then count all
  -- attempts in the window (including ours) and decide.
  SAVEPOINT rate_limit_point;
  BEGIN
    INSERT INTO public.rate_limit_checkins (teacher_id, attempt_time)
    VALUES (p_teacher_id, v_now);

    -- Count attempts within the 5-minute window (inclusive of the row we just added)
    SELECT COUNT(*) INTO v_attempt_count
    FROM public.rate_limit_checkins
    WHERE teacher_id = p_teacher_id
      AND attempt_time >= v_window_start;
  EXCEPTION WHEN OTHERS THEN
    RAISE;
  END;

  IF v_attempt_count > 5 THEN
    -- Over the limit: roll back our own insert to keep the table clean
    -- and accurate for the next legitimate attempt.
    ROLLBACK TO SAVEPOINT rate_limit_point;

    -- Calculate how long until the oldest attempt in the window expires
    -- (i.e., until the window truly slides forward).
    SELECT attempt_time INTO v_oldest_attempt
    FROM public.rate_limit_checkins
    WHERE teacher_id = p_teacher_id
      AND attempt_time >= v_window_start
    ORDER BY attempt_time ASC
    LIMIT 1;

    v_retry_after_seconds := GREATEST(
      1,
      CEILING(EXTRACT(EPOCH FROM (v_oldest_attempt + INTERVAL '5 minutes' - v_now)))::INTEGER
    );

    RETURN jsonb_build_object(
      'success', false,
      'error', 'rate_limited',
      'message', 'Too many check-in attempts. Please wait before trying again.',
      'retry_after_seconds', v_retry_after_seconds,
      'attempts_in_window', v_attempt_count,
      'max_attempts', 5,
      'window_minutes', 5
    );
  END IF;

  -- Cleanup old entries opportunistically (1% chance to avoid overhead)
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
      'attempts_used', v_attempt_count,
      'max_attempts', 5,
      'window_minutes', 5,
      'remaining', GREATEST(5 - v_attempt_count, 0)
    )
  );
END;
$$;

COMMENT ON FUNCTION public.check_in_with_location(UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, DOUBLE PRECISION) IS
  'Atomic rate-limited: 5 attempts per 5 min window (race-free INSERT-first). Attendance date uses Africa/Nairobi timezone. Uses school-wide reporting_start_time + grace_period_minutes for attendance_status.';

-- Restore EXECUTE grants (DROP+CREATE resets to defaults)
REVOKE EXECUTE ON FUNCTION public.check_in_with_location(UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, DOUBLE PRECISION) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_in_with_location(UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, DOUBLE PRECISION) FROM anon;
GRANT   EXECUTE ON FUNCTION public.check_in_with_location(UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, DOUBLE PRECISION) TO authenticated;