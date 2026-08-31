-- ============================================
-- 00037_guard_report_rpcs.sql
-- ============================================
-- WHY:
--   These four SECURITY DEFINER functions return SCHOOL-WIDE data
--   (every teacher's name, staff number, attendance, lateness, etc.).
--   They granted EXECUTE to `authenticated` (and get_attendance_analytics
--   to anon/authenticated) with NO internal authorization check, so any
--   logged-in teacher — or, via PostgREST + the public anon key, any
--   caller at all — could read the entire staff's attendance PII by
--   invoking the RPC directly. Verified against live prod on 2026-08-27.
--
--   FIX: add an internal `public.is_admin()` guard as the first statement
--   of each function. Legitimate callers are admin-only (src/services/
--   admin.ts, reached solely from AdminRoute-gated pages), so admins are
--   unaffected. Non-admins (incl. anon, whose auth.uid() is NULL) now get
--   SQLSTATE 42501 -> HTTP 403 instead of data.
--
--   auth.uid() reads the request JWT claim, which is preserved inside a
--   SECURITY DEFINER context, so is_admin() correctly evaluates the
--   CALLER's role, not the function owner's. (Same mechanism the RLS
--   policies already use.)
--
--   ALSO: pin search_path to `pg_catalog, public, pg_temp` on all four.
--   Previously unset -> pg_temp was implicitly searched FIRST, letting a
--   caller shadow unqualified table names (teachers/attendance/...) via a
--   session temp table. Listing pg_temp LAST closes that vector while
--   keeping every existing unqualified reference resolving exactly as
--   before (pg_catalog for builtins, public for app tables). Bodies are
--   otherwise reproduced verbatim from the live definitions.
--
-- NOTE: get_attendance_analytics has no frontend caller today, but it is
--   still PostgREST-exposed, so it is guarded here for defense in depth.
-- ============================================

-- --------------------------------------------
-- get_admin_dashboard_stats()
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.get_admin_dashboard_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_today DATE := CURRENT_DATE;
  v_total_teachers INTEGER;
  v_present_today INTEGER;
  v_late_today INTEGER;
  v_absent_today INTEGER;
  v_checked_out_today INTEGER;
  v_in_school_now INTEGER;
  v_early_departure_today INTEGER;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access denied: admin role required' USING ERRCODE = '42501';
  END IF;

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

  SELECT COUNT(*) INTO v_early_departure_today
  FROM attendance
  WHERE attendance_date = v_today AND attendance_status = 'EARLY_DEPARTURE';

  RETURN jsonb_build_object(
    'total_teachers', v_total_teachers,
    'present_today', v_present_today,
    'late_today', v_late_today,
    'absent_today', v_absent_today,
    'checked_out_today', v_checked_out_today,
    'in_school_now', v_in_school_now,
    'early_departure_today', v_early_departure_today
  );
END;
$function$;

-- --------------------------------------------
-- get_daily_report(p_date date DEFAULT CURRENT_DATE)
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.get_daily_report(p_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_present INTEGER;
  v_late INTEGER;
  v_absent INTEGER;
  v_early_departure INTEGER;
  v_total INTEGER;
  v_avg_check_in TEXT;
  v_avg_working_minutes NUMERIC;
  v_attendance_rate NUMERIC;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access denied: admin role required' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*) INTO v_present FROM attendance WHERE attendance_date = p_date AND status IN ('present', 'checked_out');
  SELECT COUNT(*) INTO v_late FROM attendance WHERE attendance_date = p_date AND status IN ('late', 'checked_out') AND late_minutes > 0;
  SELECT COUNT(*) INTO v_absent FROM attendance WHERE attendance_date = p_date AND status = 'absent';
  SELECT COUNT(*) INTO v_early_departure FROM attendance WHERE attendance_date = p_date AND attendance_status = 'EARLY_DEPARTURE';
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
    'early_departure', v_early_departure,
    'total_teachers', v_total,
    'attendance_rate', v_attendance_rate,
    'avg_check_in_time', COALESCE(v_avg_check_in, '-'),
    'avg_working_minutes', COALESCE(v_avg_working_minutes, 0)
  );
END;
$function$;

-- --------------------------------------------
-- get_monthly_report(p_year integer, p_month integer)
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.get_monthly_report(p_year integer, p_month integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_total_days INTEGER;
  v_present_days INTEGER;
  v_late_days INTEGER;
  v_absent_days INTEGER;
  v_early_departure_days INTEGER;
  v_attendance_pct NUMERIC;
  v_avg_working NUMERIC;
  v_total_teachers INTEGER;
  v_start_date DATE;
  v_end_date DATE;
  v_result JSONB;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access denied: admin role required' USING ERRCODE = '42501';
  END IF;

  v_start_date := make_date(p_year, p_month, 1);
  v_end_date := (v_start_date + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

  SELECT COUNT(*) INTO v_total_teachers FROM teachers WHERE employment_status = 'active';

  SELECT
    COUNT(*) FILTER (WHERE status IN ('present', 'checked_out')),
    COUNT(*) FILTER (WHERE status = 'late' OR (status IN ('present', 'checked_out') AND late_minutes > 0)),
    COUNT(*) FILTER (WHERE status = 'absent'),
    COUNT(*) FILTER (WHERE attendance_status = 'EARLY_DEPARTURE'),
    ROUND(AVG(working_minutes))
  INTO v_present_days, v_late_days, v_absent_days, v_early_departure_days, v_avg_working
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
    'early_departure_days', v_early_departure_days,
    'attendance_percentage', v_attendance_pct,
    'avg_working_minutes', COALESCE(v_avg_working, 0)
  );
END;
$function$;

-- --------------------------------------------
-- get_attendance_analytics(p_year, p_month, p_teacher_id)
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.get_attendance_analytics(p_year integer DEFAULT EXTRACT(year FROM CURRENT_DATE), p_month integer DEFAULT EXTRACT(month FROM CURRENT_DATE), p_teacher_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_start_date DATE;
  v_end_date DATE;
  v_result JSONB;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access denied: admin role required' USING ERRCODE = '42501';
  END IF;

  v_start_date := make_date(p_year, p_month, 1);
  v_end_date := (v_start_date + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

  WITH teacher_stats AS (
    SELECT
      t.id AS teacher_id,
      t.full_name,
      t.staff_number,
      COUNT(a.id) AS total_days,
      COUNT(a.id) FILTER (WHERE a.status IN ('present', 'checked_out')) AS present_days,
      COUNT(a.id) FILTER (WHERE a.status = 'late') AS late_days,
      COUNT(a.id) FILTER (WHERE a.status = 'absent') AS absent_days,
      COALESCE(ROUND(AVG(a.late_minutes) FILTER (WHERE a.status = 'late')), 0) AS avg_late_minutes,
      COALESCE(ROUND(AVG(a.working_minutes) FILTER (WHERE a.working_minutes IS NOT NULL)), 0) AS avg_working_minutes,
      CASE
        WHEN COUNT(a.id) > 0
        THEN ROUND(
          (COUNT(a.id) FILTER (WHERE a.status IN ('present', 'checked_out', 'late')))::NUMERIC
          / COUNT(a.id) * 100
        )
        ELSE 0
      END AS attendance_percentage
    FROM teachers t
    LEFT JOIN attendance a ON a.teacher_id = t.id
      AND a.attendance_date BETWEEN v_start_date AND v_end_date
    WHERE t.employment_status = 'active'
      AND (p_teacher_id IS NULL OR t.id = p_teacher_id)
    GROUP BY t.id, t.full_name, t.staff_number
  )
  SELECT jsonb_build_object(
    'period', jsonb_build_object('year', p_year, 'month', p_month, 'start', v_start_date, 'end', v_end_date),
    'teachers', COALESCE(jsonb_agg(ts ORDER BY ts.attendance_percentage ASC), '[]'::jsonb),
    'summary', (
      SELECT jsonb_build_object(
        'total_teachers', COUNT(*),
        'avg_attendance_rate', ROUND(AVG(attendance_percentage)),
        'frequent_late_count', COUNT(*) FILTER (WHERE late_days >= 3),
        'high_absent_count', COUNT(*) FILTER (WHERE absent_days >= 2)
      )
      FROM teacher_stats
    )
  ) INTO v_result
  FROM teacher_stats ts;

  RETURN v_result;
END;
$function$;
