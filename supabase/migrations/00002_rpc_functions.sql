-- ============================================
-- JK Attendance - RPC Functions & Cron Jobs
-- ============================================

-- ============================================
-- 1. CHECK-IN RPC (server-side, single transaction)
-- ============================================
-- Eliminates race conditions, uses NOW() for timestamps.
-- Call via: supabase.rpc('check_in', { p_teacher_id, p_reporting_time })

CREATE OR REPLACE FUNCTION check_in(
  p_teacher_id UUID,
  p_reporting_time TIME DEFAULT '07:20'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_today DATE := CURRENT_DATE;
  v_now TIMESTAMPTZ := NOW();
  v_late_minutes INTEGER := 0;
  v_status TEXT := 'present';
  v_existing_check_in TIMESTAMPTZ;
  v_row RECORD;
BEGIN
  -- Check for existing record today
  SELECT check_in INTO v_existing_check_in
  FROM attendance
  WHERE teacher_id = p_teacher_id AND attendance_date = v_today;

  IF FOUND THEN
    IF v_existing_check_in IS NOT NULL THEN
      RETURN jsonb_build_object('error', 'already_checked_in');
    END IF;
  END IF;

  -- Compute late minutes against server time
  IF v_now::TIME > p_reporting_time THEN
    v_late_minutes := EXTRACT(EPOCH FROM (v_now::TIME - p_reporting_time)) / 60;
    v_status := 'late';
  END IF;

  -- UPSERT: insert or update if row exists (without check_in set)
  INSERT INTO attendance (teacher_id, attendance_date, check_in, status, late_minutes)
  VALUES (p_teacher_id, v_today, v_now, v_status, v_late_minutes)
  ON CONFLICT (teacher_id, attendance_date)
  DO UPDATE SET
    check_in = v_now,
    status = v_status,
    late_minutes = v_late_minutes
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;


-- ============================================
-- 2. UNDO CHECK-OUT RPC (30-second window)
-- ============================================
-- Reverts check_out and working_minutes, recomputes status from late_minutes.
-- Only allowed within 30 seconds of checkout.

CREATE OR REPLACE FUNCTION undo_check_out(
  p_attendance_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row RECORD;
  v_check_out_time TIMESTAMPTZ;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  SELECT * INTO v_row FROM attendance WHERE id = p_attendance_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  IF v_row.check_out IS NULL THEN
    RETURN jsonb_build_object('error', 'not_checked_out');
  END IF;

  -- 30-second undo window
  IF v_now - v_row.check_out > INTERVAL '30 seconds' THEN
    RETURN jsonb_build_object('error', 'undo_window_expired');
  END IF;

  UPDATE attendance
  SET
    check_out = NULL,
    working_minutes = NULL,
    status = CASE WHEN COALESCE(v_row.late_minutes, 0) > 0 THEN 'late' ELSE 'present' END
  WHERE id = p_attendance_id
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;


-- ============================================
-- 3. END-OF-DAY AUTO PROCESSING
-- ============================================
-- Called via pg_cron at 23:59 daily.
--   a) Teachers checked in but not out → auto-check-out
--   b) Active teachers with no record → mark absent

CREATE OR REPLACE FUNCTION process_end_of_day()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_today DATE := CURRENT_DATE;
  v_end_of_day TIMESTAMPTZ := (CURRENT_DATE + INTERVAL '1 day' - INTERVAL '1 second');
  v_record RECORD;
BEGIN
  -- a) Auto check-out for teachers who forgot
  FOR v_record IN
    SELECT id, check_in
    FROM attendance
    WHERE attendance_date = v_today AND check_in IS NOT NULL AND check_out IS NULL
  LOOP
    UPDATE attendance
    SET
      check_out = v_end_of_day,
      working_minutes = GREATEST(0, EXTRACT(EPOCH FROM (v_end_of_day - v_record.check_in)) / 60),
      status = 'checked_out'
    WHERE id = v_record.id;
  END LOOP;

  -- b) Mark absent for active teachers with no record today
  INSERT INTO attendance (teacher_id, attendance_date, status)
  SELECT t.id, v_today, 'absent'
  FROM teachers t
  WHERE t.employment_status = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM attendance a
      WHERE a.teacher_id = t.id AND a.attendance_date = v_today
    );
END;
$$;


-- ============================================
-- 4. SCHEDULE CRON JOB
-- ============================================
-- Runs every day at 23:59.
-- Note: Requires pg_cron extension (available on Supabase Pro).
-- For free tier, use a Supabase Edge Function + pg_net or external scheduler.

-- CREATE EXTENSION IF NOT EXISTS pg_cron;
-- SELECT cron.schedule('end-of-day-process', '59 23 * * *', 'SELECT process_end_of_day()');
