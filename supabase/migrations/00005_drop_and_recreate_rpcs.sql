-- ============================================
-- Drop existing RPC functions to allow return-type changes
-- ============================================

DROP FUNCTION IF EXISTS check_in(UUID, TIME);
DROP FUNCTION IF EXISTS check_out(UUID);
DROP FUNCTION IF EXISTS undo_check_out(UUID);
DROP FUNCTION IF EXISTS process_end_of_day();

-- ============================================
-- 1. CHECK-IN RPC
-- ============================================

CREATE FUNCTION check_in(
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
  SELECT check_in INTO v_existing_check_in
  FROM attendance
  WHERE teacher_id = p_teacher_id AND attendance_date = v_today;

  IF FOUND THEN
    IF v_existing_check_in IS NOT NULL THEN
      RETURN jsonb_build_object('error', 'already_checked_in');
    END IF;
  END IF;

  IF v_now::TIME > p_reporting_time THEN
    v_late_minutes := EXTRACT(EPOCH FROM (v_now::TIME - p_reporting_time)) / 60;
    v_status := 'late';
  END IF;

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
-- 2. CHECK-OUT RPC
-- ============================================

CREATE FUNCTION check_out(p_attendance_id UUID)
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
-- 3. UNDO CHECK-OUT RPC
-- ============================================

CREATE FUNCTION undo_check_out(p_attendance_id UUID)
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
-- 4. END-OF-DAY PROCESSING
-- ============================================

CREATE FUNCTION process_end_of_day()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_today DATE := CURRENT_DATE;
  v_end_of_day TIMESTAMPTZ := (CURRENT_DATE + INTERVAL '1 day' - INTERVAL '1 second');
  v_is_holiday BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM school_holidays WHERE date = v_today) INTO v_is_holiday;

  IF v_is_holiday THEN
    RETURN;
  END IF;

  UPDATE attendance a
  SET
    check_out = v_end_of_day,
    working_minutes = GREATEST(0, EXTRACT(EPOCH FROM (v_end_of_day - a.check_in)) / 60),
    status = 'checked_out'
  WHERE a.attendance_date = v_today
    AND a.check_in IS NOT NULL
    AND a.check_out IS NULL;

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
