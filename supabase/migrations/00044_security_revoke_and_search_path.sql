-- ============================================
-- JK Attendance - Migration 00044 (revised)
-- Security hardening: revoke EXECUTE FROM PUBLIC
-- on privileged RPCs and grant only to required roles.
--
-- WHY THE PREVIOUS ATTEMPTS FAILED
--   00036/00038/00042 issued
--     REVOKE EXECUTE ... FROM anon, authenticated;
--   But each CREATE OR REPLACE FUNCTION (in 00041, 00042, 00043, etc.)
--   re-applies the default GRANT EXECUTE TO PUBLIC. PUBLIC is the implicit
--   parent of both `anon` and `authenticated`, so the specific REVOKEs from
--   those roles are no-ops as long as PUBLIC still has EXECUTE.
--
--   FIX: REVOKE EXECUTE FROM PUBLIC, then explicitly GRANT only to
--   service_role (and, where appropriate, to `authenticated` for the
--   frontend-facing functions).
--
--   Frontend-facing functions that DO need to be callable by `authenticated`
--   are handled separately below: check_in_with_location, check_out,
--   undo_check_out, get_month_calendar, check_calendar_date — these
--   keep GRANT EXECUTE TO authenticated.
--
--   Functions the frontend must NEVER call directly (everything else) get
--   GRANT EXECUTE TO service_role only.
--
-- SAFETY
--   No application code changes required. The frontend already calls
--   check_in_with_location, check_out, undo_check_out, get_month_calendar,
--   check_calendar_date, and the report/dashboard RPCs via authenticated
--   sessions; all of those keep their `authenticated` grant.
--   No SECURITY DEFINER flips. No RLS changes.
-- ============================================

-- ============================================
-- 1. PRIVILEGED MUTATIONS — service_role only
-- ============================================

REVOKE EXECUTE ON FUNCTION public.process_end_of_day()                FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.process_end_of_day()                TO service_role;

REVOKE EXECUTE ON FUNCTION public.delete_teacher_cascade(uuid)        FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.delete_teacher_cascade(uuid)        TO service_role;

REVOKE EXECUTE ON FUNCTION public.check_teacher_available(text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.check_teacher_available(text, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.cleanup_rate_limit_checkins()       FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.cleanup_rate_limit_checkins()       TO service_role;

-- ============================================
-- 2. FRONTEND-FACING — authenticated only
--    (these are already internally guarded by is_teacher_owner / is_admin)
-- ============================================

-- check_in_with_location: caller must be the teacher or admin
REVOKE EXECUTE ON FUNCTION public.check_in_with_location(uuid, double precision, double precision, text, text, double precision) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.check_in_with_location(uuid, double precision, double precision, text, text, double precision) TO authenticated;

-- check_out / undo_check_out: caller must own the row
REVOKE EXECUTE ON FUNCTION public.check_out(uuid)      FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.check_out(uuid)      TO authenticated;
REVOKE EXECUTE ON FUNCTION public.undo_check_out(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.undo_check_out(uuid) TO authenticated;

-- Legacy check_in (superseded by check_in_with_location; revoke entirely)
REVOKE EXECUTE ON FUNCTION public.check_in(uuid, time) FROM PUBLIC;

-- Calendar reads
REVOKE EXECUTE ON FUNCTION public.get_month_calendar(integer, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_month_calendar(integer, integer) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.check_calendar_date(date) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.check_calendar_date(date) TO authenticated;

-- Calendar admin (auto-populate weekends) — admin-gated in the app
REVOKE EXECUTE ON FUNCTION public.auto_populate_weekends(integer, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.auto_populate_weekends(integer, integer) TO authenticated;

-- ============================================
-- 3. INTERNAL HELPERS — service_role only
-- ============================================

REVOKE EXECUTE ON FUNCTION public.check_rate_limit(uuid, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.check_rate_limit(uuid, integer) TO service_role;

-- ============================================
-- 4. IDENTITY / OWNERSHIP LEAKS
--    These leak who is admin / who owns what.
--    RLS policies invoke them INLINE so they must remain callable
--    by the `authenticated` role when RLS is being evaluated.
--    anon should NOT call them directly.
-- ============================================

REVOKE EXECUTE ON FUNCTION public.is_admin()             FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_admin()             TO authenticated;

REVOKE EXECUTE ON FUNCTION public.is_teacher_owner(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_teacher_owner(uuid) TO authenticated;

-- ============================================
-- 5. MISC — service_role only
-- ============================================

REVOKE EXECUTE ON FUNCTION public.app_set_cron_secret() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.app_set_cron_secret() TO service_role;

-- ============================================
-- 6. Pin search_path on remaining SECURITY DEFINER functions
-- ============================================

ALTER FUNCTION public.set_updated_at()
  SET search_path = pg_catalog, public, pg_temp;

ALTER FUNCTION public.compute_attendance_status(
  p_check_in_time time, p_check_out_time time,
  p_reporting_start time, p_grace_minutes integer, p_checkout_time time
)
  SET search_path = pg_catalog, public, pg_temp;

ALTER FUNCTION public.compute_late_minutes(
  p_check_in_time time, p_reporting_start time, p_grace_minutes integer
)
  SET search_path = pg_catalog, public, pg_temp;

ALTER FUNCTION public.compute_early_departure_minutes(
  p_check_out_time time, p_checkout_time time
)
  SET search_path = pg_catalog, public, pg_temp;

ALTER FUNCTION public.format_working_hours(
  p_check_in timestamptz, p_check_out timestamptz
)
  SET search_path = pg_catalog, public, pg_temp;

ALTER FUNCTION public.app_set_cron_secret()
  SET search_path = pg_catalog, public, pg_temp;

-- ============================================
-- 7. VERIFICATION
-- ============================================
-- Run after push:
--
--   SELECT r.routine_name,
--          string_agg(p.grantee, ', ' ORDER BY p.grantee) AS grantees
--   FROM information_schema.routines r
--   LEFT JOIN information_schema.routine_privileges p
--     ON p.routine_schema = r.routine_schema
--    AND p.routine_name   = r.routine_name
--   WHERE r.routine_schema = 'public'
--     AND r.routine_name IN (
--       'process_end_of_day','delete_teacher_cascade','check_teacher_available',
--       'check_in','check_out','undo_check_out','check_in_with_location',
--       'check_rate_limit','cleanup_rate_limit_checkins','auto_populate_weekends',
--       'is_teacher_owner','is_admin','app_set_cron_secret',
--       'get_month_calendar','check_calendar_date'
--     )
--   GROUP BY r.routine_name
--   ORDER BY 1;
--   -- expect:
--   --   process_end_of_day      | service_role
--   --   delete_teacher_cascade  | service_role
--   --   check_teacher_available | service_role
--   --   cleanup_rate_limit_checkins | service_role
--   --   app_set_cron_secret     | service_role
--   --   check_rate_limit        | service_role
--   --   check_in                | (empty)
--   --   check_in_with_location  | authenticated
--   --   check_out               | authenticated
--   --   undo_check_out          | authenticated
--   --   get_month_calendar      | authenticated
--   --   check_calendar_date     | authenticated
--   --   auto_populate_weekends  | authenticated
--   --   is_admin                | authenticated
--   --   is_teacher_owner        | authenticated
-- ============================================
