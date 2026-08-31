-- ============================================
-- 00036_revoke_privileged_rpc_execute.sql
-- ============================================
-- WHY:
--   These SECURITY DEFINER functions are only ever invoked by the
--   admin-gated edge functions (delete-teacher) and the scheduled cron
--   job, all of which connect with the service_role key. They were,
--   however, also EXECUTE-able by `anon` and `authenticated` — verified
--   against the live database on 2026-08-27 — which means any client
--   holding the public anon key (shipped in the browser bundle) could
--   call them directly via PostgREST and bypass the edge-function
--   authorization checks entirely.
--
--   Concrete exposure closed here:
--     * delete_teacher_cascade  — any caller could permanently delete ANY
--                                 teacher, cascading their attendance +
--                                 notifications and deleting their auth login.
--     * process_end_of_day      — any caller could trigger bulk end-of-day
--                                 processing (mass check-out / absent marking).
--     * check_teacher_available — any caller could enumerate whether an email
--                                 or staff number exists.
--
--   service_role is NOT affected by "REVOKE ... FROM anon, authenticated",
--   so the edge functions and cron job continue to work unchanged. The
--   frontend never calls these three functions directly (verified: no
--   supabase.rpc('delete_teacher_cascade' | 'process_end_of_day' |
--   'check_teacher_available') anywhere in src/), so the app is unaffected.
--
-- NOTE: The report RPCs (get_monthly_report, …), the attendance RPCs
--   (check_in_with_location, check_out, undo_check_out) and search_path
--   hardening are handled in follow-up migrations, because those functions
--   ARE called directly from the browser and need internal is_admin()/
--   ownership guards rather than a blanket REVOKE.
-- ============================================

REVOKE EXECUTE ON FUNCTION public.delete_teacher_cascade(uuid)        FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.process_end_of_day()                FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_teacher_available(text, text) FROM anon, authenticated;
