-- ============================================
-- JK Attendance - Migration 00045
-- Minimal remediation: per Performance/Security audit
--  * RLS performance: wrap auth.uid() in (SELECT ...)
--  * auto_populate_weekends: add is_admin() guard
--  * Drop confirmed-duplicate attendance_notifications policies
--  * No changes to set_updated_at (investigation only)
-- ============================================

-- ============================================
-- 1. auto_populate_weekends — add is_admin() guard
--    Follows the 00037 pattern.
--    SECURITY DEFINER retained (no business logic change).
--    search_path retained.
-- ============================================
CREATE OR REPLACE FUNCTION public.auto_populate_weekends(
  p_start_year integer DEFAULT EXTRACT(year FROM CURRENT_DATE),
  p_end_year   integer DEFAULT (EXTRACT(year FROM CURRENT_DATE) + 1)
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public, pg_temp
AS $$
DECLARE
  v_date  DATE;
  v_dow   INTEGER;
  v_count INTEGER := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access denied: admin role required'
      USING ERRCODE = '42501';
  END IF;

  v_date := make_date(p_start_year, 1, 1);

  WHILE v_date <= make_date(p_end_year, 12, 31) LOOP
    v_dow := EXTRACT(DOW FROM v_date);

    IF v_dow IN (0, 6) THEN
      INSERT INTO school_calendar (calendar_date, day_type, title)
      VALUES (
        v_date,
        'weekend',
        CASE v_dow WHEN 0 THEN 'Sunday' ELSE 'Saturday' END
      )
      ON CONFLICT (calendar_date)
      DO UPDATE SET day_type = 'weekend',
                    title   = CASE v_dow WHEN 0 THEN 'Sunday' ELSE 'Saturday' END
      WHERE school_calendar.day_type <> 'holiday'
        AND school_calendar.day_type <> 'event';

      v_count := v_count + 1;
    END IF;

    v_date := v_date + INTERVAL '1 day';
  END LOOP;

  RETURN v_count;
END;
$$;

-- ============================================
-- 2. RLS performance: wrap auth.uid() in (SELECT ...)
--    Same semantics, better plan (initplan caching).
-- ============================================

-- 2a. profiles: "Users read own profile"
DROP POLICY IF EXISTS "Users read own profile" ON public.profiles;
CREATE POLICY "Users read own profile"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (id = (SELECT auth.uid()));

-- 2b. profiles: "Users update own profile"
DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

-- 2c. teachers: "Teachers read own profile"
DROP POLICY IF EXISTS "Teachers read own profile" ON public.teachers;
CREATE POLICY "Teachers read own profile"
  ON public.teachers FOR SELECT
  TO authenticated
  USING (
    id           = (SELECT auth.uid())
    OR user_id      = (SELECT auth.uid())
    OR auth_user_id = (SELECT auth.uid())
  );

-- 2d. attendance: "Teachers manage own attendance"
DROP POLICY IF EXISTS "Teachers manage own attendance" ON public.attendance;
CREATE POLICY "Teachers manage own attendance"
  ON public.attendance FOR ALL
  TO authenticated
  USING (
    teacher_id IN (
      SELECT id FROM public.teachers
      WHERE id           = (SELECT auth.uid())
         OR user_id      = (SELECT auth.uid())
         OR auth_user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    teacher_id IN (
      SELECT id FROM public.teachers
      WHERE id           = (SELECT auth.uid())
         OR user_id      = (SELECT auth.uid())
         OR auth_user_id = (SELECT auth.uid())
    )
  );

-- ============================================
-- 3. Drop confirmed-duplicate policies
--    (00032 renamed them; the old names are leftovers)
-- ============================================
DROP POLICY IF EXISTS "Admins insert notifications" ON public.attendance_notifications;
DROP POLICY IF EXISTS "Admins read notifications"  ON public.attendance_notifications;
