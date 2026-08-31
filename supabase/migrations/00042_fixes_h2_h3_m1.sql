-- ============================================
-- JK Attendance - Migration 00042
-- Fixes for H2 (idempotent process_end_of_day), H3 (email enumeration), M1 (rate limiting)
-- ============================================

-- ============================================
-- H2: Make process_end_of_day IDEMPOTENT
-- ============================================
-- Problem: The function can be called multiple times (cron retries, manual invocation)
-- and will duplicate absent records or double-update auto-checkouts.
-- Fix: Use INSERT ... ON CONFLICT DO NOTHING for absents, and only update
-- attendance rows that haven't been processed yet.
-- Also add search_path hardening per security baseline.
-- ============================================
-- Cannot change return type of existing function, so drop first
DROP FUNCTION IF EXISTS public.process_end_of_day();

CREATE OR REPLACE FUNCTION process_end_of_day()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_today DATE := CURRENT_DATE;
  v_end_of_day TIMESTAMPTZ := (CURRENT_DATE + INTERVAL '1 day' - INTERVAL '1 second');
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
  -- Only update rows that are still checked in (check_out IS NULL)
  -- and haven't been processed (check_out_expires_at IS NULL or expired)
  -- The WHERE clause naturally makes this idempotent - already checked-out
  -- rows won't match.
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
  -- Use ON CONFLICT DO NOTHING on the unique constraint
  -- (teacher_id, attendance_date) so re-runs don't duplicate.
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

-- Grant EXECUTE to service_role only (edge functions use service_role)
-- Revoke from anon/authenticated (already done in 00036, but explicit here for clarity)
REVOKE EXECUTE ON FUNCTION public.process_end_of_day() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_end_of_day() TO service_role;


-- ============================================
-- M1: Rate limiting for check_in_with_location
-- ============================================
-- Create a dedicated rate limit table with automatic cleanup
-- Max 5 check-in attempts per teacher per 5-minute window
-- ============================================

CREATE TABLE IF NOT EXISTS public.rate_limit_checkins (
  teacher_id UUID NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
  attempt_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (teacher_id, attempt_time)
);

-- Index for efficient window queries
CREATE INDEX IF NOT EXISTS idx_rate_limit_checkins_teacher_time
ON public.rate_limit_checkins (teacher_id, attempt_time DESC);

-- Enable RLS
ALTER TABLE public.rate_limit_checkins ENABLE ROW LEVEL SECURITY;

-- Policy: Only service_role can insert (via RPC); no one can SELECT/UPDATE/DELETE
-- The RPC runs SECURITY DEFINER so it bypasses RLS for the insert
CREATE POLICY "rate_limit_checkins_service_role_only" ON public.rate_limit_checkins
FOR ALL TO service_role USING (true) WITH CHECK (true);

-- No policies for anon/authenticated = no access

-- Function to cleanup old rate limit entries (older than 1 hour)
-- Can be called periodically or as part of the check-in function
CREATE OR REPLACE FUNCTION public.cleanup_rate_limit_checkins()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM public.rate_limit_checkins
  WHERE attempt_time < NOW() - INTERVAL '1 hour';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- ============================================
-- Updated check_in_with_location with RATE LIMITING
-- ============================================
-- Adds: 5 attempts per 5-minute rolling window per teacher
-- Returns rate limit info in response for UI countdown
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
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_settings RECORD;
  v_distance DOUBLE PRECISION;
  v_today DATE := CURRENT_DATE;
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
    -- Get oldest attempt in window to calculate retry-after
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
    -- Rate limit info for UI
    'rate_limit', jsonb_build_object(
      'attempts_used', v_attempt_count + 1,
      'max_attempts', 5,
      'window_minutes', 5,
      'remaining', GREATEST(5 - (v_attempt_count + 1), 0)
    )
  );
END;
$$;


-- ============================================
-- H3: Helper function for invite-teacher edge function
-- This replaces listUsers() with getUserByEmail() to prevent enumeration
-- ============================================
-- Note: This is a SQL helper, but the actual fix is in the edge function code.
-- The edge function should use supabase.auth.admin.getUserByEmail(email)
-- instead of supabase.auth.admin.listUsers()
-- This migration documents the pattern and provides a utility if needed.

-- No SQL migration needed for H3 - the fix is in the edge function code.
-- But we add a comment here for traceability.
COMMENT ON FUNCTION public.check_in_with_location IS
  'Rate limited: 5 attempts per 5 min window. Returns rate_limit info in response.';


-- ============================================
-- Verification queries (run manually after applying)
-- ============================================
-- 1. Verify process_end_of_day is idempotent:
--    SELECT process_end_of_day();  -- first run
--    SELECT process_end_of_day();  -- second run should return 0 new absents
--
-- 2. Verify rate limiting:
--    -- Call check_in_with_location 5 times rapidly -> 6th should fail with rate_limited
--    -- Wait 5 minutes -> should work again
--
-- 3. Verify rate_limit_checkins table:
--    SELECT * FROM public.rate_limit_checkins ORDER BY attempt_time DESC LIMIT 20;