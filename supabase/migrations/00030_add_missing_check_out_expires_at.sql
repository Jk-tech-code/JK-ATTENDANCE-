-- ============================================
-- JK Attendance - Migration 00030
-- Add missing check_out_expires_at column
-- The column was supposed to exist from 00003/00004
-- but was never created in the production database.
-- Also re-declares the latest check_out & undo_check_out RPCs.
-- ============================================

-- ============================================
-- 1. ADD MISSING COLUMN (idempotent)
-- ============================================
ALTER TABLE attendance
ADD COLUMN IF NOT EXISTS check_out_expires_at TIMESTAMPTZ;

-- ============================================
-- 2. RE-CREATE CHECK_OUT RPC (latest from 00021)
-- Uses 5-minute undo window
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
    check_out_expires_at = v_now + INTERVAL '5 minutes'
  WHERE id = p_attendance_id
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;

-- ============================================
-- 3. RE-CREATE UNDO_CHECK_OUT RPC (latest from 00021)
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
-- 4. VERIFICATION QUERY
-- ============================================
-- Run this after migration to confirm:
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'attendance' AND column_name = 'check_out_expires_at';
