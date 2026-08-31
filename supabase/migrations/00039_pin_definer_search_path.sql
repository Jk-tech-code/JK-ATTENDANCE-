-- 00039_pin_definer_search_path.sql
--
-- Hardening: pin search_path on the remaining SECURITY DEFINER functions.
--
-- WHY
--   These 8 functions run as SECURITY DEFINER (owner privileges) but had a
--   mutable search_path. Postgres implicitly searches pg_temp FIRST when it is
--   not listed, so a caller who creates e.g. pg_temp.teachers before invoking
--   is_admin() could shadow public.teachers and subvert the privilege check
--   (Supabase linter: "function_search_path_mutable").
--
-- FIX
--   Pin search_path = pg_catalog, public, pg_temp on each (pg_temp LAST so it can
--   never shadow public objects; pg_catalog FIRST so built-ins can't be overridden).
--   Bodies are UNCHANGED — every one references only public tables/functions plus
--   pg_catalog built-ins and the schema-qualified auth.uid(), all resolvable under
--   this path. Verified: none reference the `extensions` schema (no earthdistance/cube).
--
-- SAFETY
--   ALTER FUNCTION ... SET is non-destructive (no logic change) and re-runnable.

ALTER FUNCTION public.is_admin()
  SET search_path = pg_catalog, public, pg_temp;

ALTER FUNCTION public.is_teacher_owner(p_teacher_id uuid)
  SET search_path = pg_catalog, public, pg_temp;

ALTER FUNCTION public.check_rate_limit(p_teacher_id uuid, p_cooldown_seconds integer)
  SET search_path = pg_catalog, public, pg_temp;

ALTER FUNCTION public.check_calendar_date(p_date date)
  SET search_path = pg_catalog, public, pg_temp;

ALTER FUNCTION public.check_in(p_teacher_id uuid, p_reporting_time time without time zone)
  SET search_path = pg_catalog, public, pg_temp;

ALTER FUNCTION public.get_month_calendar(p_year integer, p_month integer)
  SET search_path = pg_catalog, public, pg_temp;

ALTER FUNCTION public.auto_populate_weekends(p_start_year integer, p_end_year integer)
  SET search_path = pg_catalog, public, pg_temp;

ALTER FUNCTION public.process_end_of_day()
  SET search_path = pg_catalog, public, pg_temp;

-- Verify (run manually after push):
--   SELECT proname, proconfig FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
--   WHERE proname IN ('is_admin','is_teacher_owner','check_rate_limit','check_calendar_date',
--                     'check_in','get_month_calendar','auto_populate_weekends','process_end_of_day')
--   ORDER BY 1;
--   -- expect proconfig = {"search_path=pg_catalog, public, pg_temp"} for all 8
