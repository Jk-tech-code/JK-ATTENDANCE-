-- ============================================
-- JK Attendance - Complete Schema (idempotent)
-- Safe to run even if some objects already exist.
-- ============================================

-- ============================================
-- 1. TABLES (IF NOT EXISTS)
-- ============================================

CREATE TABLE IF NOT EXISTS teachers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_number TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  department TEXT,
  phone TEXT,
  reporting_time TIME DEFAULT '07:20',
  employment_status TEXT DEFAULT 'active' CHECK (employment_status IN ('active', 'inactive', 'suspended')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  attendance_date DATE NOT NULL DEFAULT CURRENT_DATE,
  check_in TIMESTAMPTZ,
  check_out TIMESTAMPTZ,
  late_minutes INTEGER,
  working_minutes INTEGER,
  status TEXT CHECK (status IN ('present', 'late', 'absent', 'checked_out')),
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  device TEXT,
  browser TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(teacher_id, attendance_date)
);

CREATE TABLE IF NOT EXISTS school_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_name TEXT,
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  allowed_radius INTEGER DEFAULT 100,
  default_reporting_time TIME DEFAULT '07:20'
);

CREATE TABLE IF NOT EXISTS school_holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL UNIQUE,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- 2. INDEXES (IF NOT EXISTS)
-- ============================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_attendance_teacher_id') THEN
    CREATE INDEX idx_attendance_teacher_id ON attendance(teacher_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_attendance_date') THEN
    CREATE INDEX idx_attendance_date ON attendance(attendance_date);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_attendance_status') THEN
    CREATE INDEX idx_attendance_status ON attendance(status);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_teachers_email') THEN
    CREATE INDEX idx_teachers_email ON teachers(email);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_teachers_staff_number') THEN
    CREATE INDEX idx_teachers_staff_number ON teachers(staff_number);
  END IF;
END $$;

-- ============================================
-- 3. NEW COLUMNS (IF NOT EXISTS)
-- ============================================

ALTER TABLE attendance
ADD COLUMN IF NOT EXISTS check_out_expires_at TIMESTAMPTZ;

-- ============================================
-- 4. ROW LEVEL SECURITY
-- ============================================

ALTER TABLE teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_holidays ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Teachers read own profile') THEN
    CREATE POLICY "Teachers read own profile"
      ON teachers FOR SELECT TO authenticated
      USING (id = auth.uid());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins read all teachers') THEN
    CREATE POLICY "Admins read all teachers"
      ON teachers FOR SELECT TO authenticated
      USING (
        EXISTS (SELECT 1 FROM auth.users WHERE id = auth.uid() AND raw_user_meta_data->>'role' = 'admin')
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Teachers manage own attendance') THEN
    CREATE POLICY "Teachers manage own attendance"
      ON attendance FOR ALL TO authenticated
      USING (teacher_id = auth.uid())
      WITH CHECK (teacher_id = auth.uid());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins read all attendance') THEN
    CREATE POLICY "Admins read all attendance"
      ON attendance FOR SELECT TO authenticated
      USING (
        EXISTS (SELECT 1 FROM auth.users WHERE id = auth.uid() AND raw_user_meta_data->>'role' = 'admin')
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users read school settings') THEN
    CREATE POLICY "Authenticated users read school settings"
      ON school_settings FOR SELECT TO authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users read school holidays') THEN
    CREATE POLICY "Authenticated users read school holidays"
      ON school_holidays FOR SELECT TO authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins manage school holidays') THEN
    CREATE POLICY "Admins manage school holidays"
      ON school_holidays FOR ALL TO authenticated
      USING (
        EXISTS (SELECT 1 FROM auth.users WHERE id = auth.uid() AND raw_user_meta_data->>'role' = 'admin')
      );
  END IF;
END $$;

-- ============================================
-- 5. RPC FUNCTIONS (CREATE OR REPLACE)
-- ============================================

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
