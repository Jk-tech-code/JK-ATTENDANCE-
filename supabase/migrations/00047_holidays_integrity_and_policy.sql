-- ============================================
-- JK Attendance - Migration 00047
-- Holidays & Events: data integrity + policy hardening
--
-- WHY
--   1. school_calendar.calendar_date has no UNIQUE constraint
--      (the original CREATE TABLE declared UNIQUE, but CREATE TABLE
--      IF NOT EXISTS in 00013 was a no-op against the pre-existing
--      table, which lacked the UNIQUE). This allowed duplicate
--      rows per date (e.g., a "weekend" + a "holiday" on the same
--      Saturday), corrupting the calendar grid.
--      FIX: add UNIQUE INDEX on calendar_date.
--
--   2. auto_populate_weekends() uses ON CONFLICT (calendar_date)
--      but without a UNIQUE constraint, the conflict target is
--      never reached, so duplicates could be inserted.
--      FIX: rewrite to use ON CONFLICT DO NOTHING (the weekend
--      row must not overwrite a manually-added holiday or event).
--      The function is now safe to re-run after the UNIQUE index
--      is in place.
--
--   3. "Admins update school_calendar" policy had USING = is_admin()
--      but WITH CHECK = NULL. Defense-in-depth: add WITH CHECK =
--      is_admin() so a non-admin row cannot be the result of an
--      admin's UPDATE (e.g., if a session were to acquire admin
--      and the row's day_type were tampered with mid-query).
--      Practical impact: zero (admins already satisfy the check),
--      but removes a warning from security audits.
--
-- SAFETY
--   * Adding UNIQUE INDEX will fail if duplicates exist. The
--     DEDUPLICATION block below removes any duplicate non-weekend
--     rows first (keeping the most recently created one), so the
--     index creation is guaranteed to succeed.
--   * The policy change is idempotent (DROP + CREATE).
--   * Re-runnable.
-- ============================================

-- ============================================
-- 1. DEDUPLICATE school_calendar
--    Keep the most recently created row per calendar_date
--    (i.e., admin-added holidays/events win over auto-populated weekends).
-- ============================================
DELETE FROM public.school_calendar a
USING public.school_calendar b
WHERE a.calendar_date = b.calendar_date
  AND (
    (a.created_at < b.created_at)
    OR (a.created_at IS NULL AND b.created_at IS NOT NULL)
    OR (a.created_at = b.created_at AND a.id < b.id)
  );

-- ============================================
-- 2. Add UNIQUE INDEX on calendar_date
-- ============================================
CREATE UNIQUE INDEX IF NOT EXISTS uq_school_calendar_date
  ON public.school_calendar (calendar_date);

-- ============================================
-- 3. Rewrite auto_populate_weekends to be conflict-safe
--    Weekend rows must NOT overwrite existing holidays/events.
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
    RAISE EXCEPTION 'Access denied: admin role required' USING ERRCODE = '42501';
  END IF;

  v_date := make_date(p_start_year, 1, 1);
  WHILE v_date <= make_date(p_end_year, 12, 31) LOOP
    v_dow := EXTRACT(DOW FROM v_date);
    IF v_dow IN (0, 6) THEN
      INSERT INTO school_calendar (calendar_date, day_type, title)
      VALUES (v_date, 'weekend', CASE v_dow WHEN 0 THEN 'Sunday' ELSE 'Saturday' END)
      ON CONFLICT (calendar_date) DO NOTHING;
      v_count := v_count + 1;
    END IF;
    v_date := v_date + INTERVAL '1 day';
  END LOOP;
  RETURN v_count;
END;
$$;

-- ============================================
-- 4. Harden Admins update school_calendar WITH CHECK
-- ============================================
DROP POLICY IF EXISTS "Admins update school_calendar" ON public.school_calendar;
CREATE POLICY "Admins update school_calendar"
  ON public.school_calendar FOR UPDATE
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- ============================================
-- 5. VERIFICATION (run after push)
-- ============================================
-- SELECT count(*) FROM pg_indexes WHERE indexname = 'uq_school_calendar_date';
--   expect: 1
--
-- SELECT calendar_date, count(*) FROM school_calendar
--   GROUP BY calendar_date HAVING count(*) > 1;
--   expect: 0 rows
--
-- SELECT proname, prosrc LIKE '%ON CONFLICT%' AS has_upsert
--   FROM pg_proc WHERE proname = 'auto_populate_weekends';
--   expect: has_upsert = true
-- ============================================
