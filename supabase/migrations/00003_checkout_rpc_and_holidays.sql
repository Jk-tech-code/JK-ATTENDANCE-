-- ============================================
-- JK Attendance - Migration 00003
-- check_out RPC, undo window, holidays, batch EOD
-- ============================================

-- ============================================
-- 1. ADD undo-window column to attendance
-- ============================================
ALTER TABLE attendance
ADD COLUMN IF NOT EXISTS check_out_expires_at TIMESTAMPTZ;


-- ============================================
-- 2. SCHOOL HOLIDAYS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS school_holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL UNIQUE,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE school_holidays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users read school holidays"
  ON school_holidays FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins manage school holidays"
  ON school_holidays FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE id = auth.uid()
      AND raw_user_meta_data->>'role' = 'admin'
    )
  );


-- ============================================
-- 3. CHECK-OUT RPC (server-side timestamp)
-- ============================================
-- Uses NOW(), sets undo expiry window.
-- Call via: supabase.rpc('check_out', { p_attendance_id })

CREATE OR REPLACE FUNCTION check_out(p_attendance_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row RECORD;
  v_now TIMESTAMPTZ := NOW();
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

  UPDATE attendance
  SET
    check_out = v_now,
    working_minutes = GREATEST(0, EXTRACT(EPOCH FROM (v_now - v_row.check_in)) / 60),
    status = 'checked_out',
    check_out_expires_at = v_now + INTERVAL '30 seconds'
  WHERE id = p_attendance_id
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;


-- ============================================
-- 4. UNDO CHECK-OUT RPC (updated for column)
-- ============================================
-- Now checks check_out_expires_at instead of a 30s calc.

CREATE OR REPLACE FUNCTION undo_check_out(p_attendance_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row RECORD;
  v_now TIMESTAMPTZ := NOW();
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

  UPDATE attendance
  SET
    check_out = NULL,
    working_minutes = NULL,
    status = CASE WHEN COALESCE(v_row.late_minutes, 0) > 0 THEN 'late' ELSE 'present' END,
    check_out_expires_at = NULL
  WHERE id = p_attendance_id
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;


-- ============================================
-- 5. END-OF-DAY (batch + holiday-aware)
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
BEGIN
  -- Skip if today is a school holiday
  SELECT EXISTS(SELECT 1 FROM school_holidays WHERE date = v_today) INTO v_is_holiday;

  IF v_is_holiday THEN
    RETURN;
  END IF;

  -- Batch auto check-out (single UPDATE, no FOR loop)
  UPDATE attendance a
  SET
    check_out = v_end_of_day,
    working_minutes = GREATEST(0, EXTRACT(EPOCH FROM (v_end_of_day - a.check_in)) / 60),
    status = 'checked_out'
  WHERE a.attendance_date = v_today
    AND a.check_in IS NOT NULL
    AND a.check_out IS NULL;

  -- Batch absent insertion
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
-- 6. CRON SCHEDULE (commented, uncomment on Pro)
-- ============================================
-- CREATE EXTENSION IF NOT EXISTS pg_cron;
-- SELECT cron.schedule('end-of-day-process', '59 23 * * *', 'SELECT process_end_of_day()');
