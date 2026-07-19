-- ============================================
-- JK Attendance - Migration 00011
-- Admin RLS policies + Dashboard stats RPC
-- ============================================

-- ============================================
-- 1. ADMIN RLS POLICIES FOR TEACHERS TABLE
-- ============================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins insert teachers') THEN
    CREATE POLICY "Admins insert teachers"
      ON teachers FOR INSERT TO authenticated
      WITH CHECK (auth.jwt() -> 'user_metadata' ->> 'role' = 'admin');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins update teachers') THEN
    CREATE POLICY "Admins update teachers"
      ON teachers FOR UPDATE TO authenticated
      USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'admin')
      WITH CHECK (auth.jwt() -> 'user_metadata' ->> 'role' = 'admin');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins delete teachers') THEN
    CREATE POLICY "Admins delete teachers"
      ON teachers FOR DELETE TO authenticated
      USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'admin');
  END IF;
END $$;

-- ============================================
-- 2. ENSURE SCHOOL_HOLIDAYS TABLE EXISTS
-- ============================================

CREATE TABLE IF NOT EXISTS school_holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL UNIQUE,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE school_holidays ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users read school holidays') THEN
    CREATE POLICY "Authenticated users read school holidays"
      ON school_holidays FOR SELECT TO authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins manage school holidays') THEN
    CREATE POLICY "Admins manage school holidays"
      ON school_holidays FOR ALL TO authenticated
      USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'admin');
  END IF;
END $$;

-- ============================================
-- 3. DASHBOARD STATS RPC (single call)
-- ============================================

CREATE OR REPLACE FUNCTION get_admin_dashboard_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_today DATE := CURRENT_DATE;
  v_total_teachers INTEGER;
  v_present_today INTEGER;
  v_late_today INTEGER;
  v_absent_today INTEGER;
  v_checked_out_today INTEGER;
  v_in_school_now INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_total_teachers
  FROM teachers
  WHERE employment_status = 'active';

  SELECT COUNT(*) INTO v_present_today
  FROM attendance
  WHERE attendance_date = v_today AND status = 'present';

  SELECT COUNT(*) INTO v_late_today
  FROM attendance
  WHERE attendance_date = v_today AND status = 'late';

  SELECT COUNT(*) INTO v_absent_today
  FROM attendance
  WHERE attendance_date = v_today AND status = 'absent';

  SELECT COUNT(*) INTO v_checked_out_today
  FROM attendance
  WHERE attendance_date = v_today AND status = 'checked_out';

  SELECT COUNT(*) INTO v_in_school_now
  FROM attendance
  WHERE attendance_date = v_today AND check_in IS NOT NULL AND check_out IS NULL;

  RETURN jsonb_build_object(
    'total_teachers', v_total_teachers,
    'present_today', v_present_today,
    'late_today', v_late_today,
    'absent_today', v_absent_today,
    'checked_out_today', v_checked_out_today,
    'in_school_now', v_in_school_now
  );
END;
$$;

-- ============================================
-- 4. DAILY REPORT RPC
-- ============================================

CREATE OR REPLACE FUNCTION get_daily_report(p_date DATE DEFAULT CURRENT_DATE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_present INTEGER;
  v_late INTEGER;
  v_absent INTEGER;
  v_total INTEGER;
  v_avg_check_in TEXT;
  v_avg_working_minutes NUMERIC;
  v_attendance_rate NUMERIC;
BEGIN
  SELECT COUNT(*) INTO v_present FROM attendance WHERE attendance_date = p_date AND status IN ('present', 'checked_out');
  SELECT COUNT(*) INTO v_late FROM attendance WHERE attendance_date = p_date AND status IN ('late', 'checked_out') AND late_minutes > 0;
  SELECT COUNT(*) INTO v_absent FROM attendance WHERE attendance_date = p_date AND status = 'absent';
  SELECT COUNT(*) INTO v_total FROM teachers WHERE employment_status = 'active';

  SELECT TO_CHAR(AVG(check_in::TIME), 'HH24:MI') INTO v_avg_check_in
  FROM attendance
  WHERE attendance_date = p_date AND check_in IS NOT NULL;

  SELECT ROUND(AVG(working_minutes)) INTO v_avg_working_minutes
  FROM attendance
  WHERE attendance_date = p_date AND working_minutes IS NOT NULL;

  v_attendance_rate := CASE WHEN v_total > 0 THEN ROUND((v_present + v_late)::NUMERIC / v_total * 100) ELSE 0 END;

  RETURN jsonb_build_object(
    'date', p_date,
    'present', v_present,
    'late', v_late,
    'absent', v_absent,
    'total_teachers', v_total,
    'attendance_rate', v_attendance_rate,
    'avg_check_in_time', COALESCE(v_avg_check_in, '-'),
    'avg_working_minutes', COALESCE(v_avg_working_minutes, 0)
  );
END;
$$;

-- ============================================
-- 5. MONTHLY REPORT RPC
-- ============================================

CREATE OR REPLACE FUNCTION get_monthly_report(p_year INTEGER, p_month INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_days INTEGER;
  v_present_days INTEGER;
  v_late_days INTEGER;
  v_absent_days INTEGER;
  v_attendance_pct NUMERIC;
  v_avg_working NUMERIC;
  v_total_teachers INTEGER;
  v_start_date DATE;
  v_end_date DATE;
  v_result JSONB;
BEGIN
  v_start_date := make_date(p_year, p_month, 1);
  v_end_date := (v_start_date + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

  SELECT COUNT(*) INTO v_total_teachers FROM teachers WHERE employment_status = 'active';

  SELECT
    COUNT(*) FILTER (WHERE status IN ('present', 'checked_out')),
    COUNT(*) FILTER (WHERE status = 'late' OR (status IN ('present', 'checked_out') AND late_minutes > 0)),
    COUNT(*) FILTER (WHERE status = 'absent'),
    ROUND(AVG(working_minutes))
  INTO v_present_days, v_late_days, v_absent_days, v_avg_working
  FROM attendance
  WHERE attendance_date BETWEEN v_start_date AND v_end_date;

  v_attendance_pct := CASE WHEN v_total_teachers > 0
    THEN ROUND((v_present_days + v_late_days)::NUMERIC / (v_total_teachers * EXTRACT(DAY FROM v_end_date)) * 100)
    ELSE 0 END;

  RETURN jsonb_build_object(
    'year', p_year, 'month', p_month,
    'total_teachers', v_total_teachers,
    'present_days', v_present_days,
    'late_days', v_late_days,
    'absent_days', v_absent_days,
    'attendance_percentage', v_attendance_pct,
    'avg_working_minutes', COALESCE(v_avg_working, 0)
  );
END;
$$;
