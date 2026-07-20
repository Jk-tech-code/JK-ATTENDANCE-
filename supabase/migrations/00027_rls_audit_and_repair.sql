-- ============================================
-- JK Attendance - Migration 00027
-- RLS Audit & Repair - Final Production Configuration
--
-- Fixes discovered issues:
--   1. school_settings: MISSING admin UPDATE/INSERT/DELETE policies
--      + SELECT restricted to admin-only (was all authenticated users)
--   2. attendance_notifications: "Teachers read own notifications"
--      uses teacher_id = auth.uid() (WRONG - teacher_id is teachers.id,
--      not auth.users.id). Fixed to use public.is_teacher_owner().
--   3. All policies now consistently use public.is_admin() and
--      public.is_teacher_owner() helper functions.
--   4. No JWT metadata references remain anywhere.
--   5. Added index on teachers.role for is_admin() performance.
--
-- NOTES:
--   - Teacher identity helper functions (is_admin, is_teacher_owner)
--     use the triple-OR pattern: (id = auth.uid() OR user_id = auth.uid()
--     OR auth_user_id = auth.uid()). This includes id = auth.uid() for
--     backward compatibility with legacy teacher records where the
--     auth_user_id column was empty. The priority order in the frontend
--     (auth.ts: getTeacherProfile) is: auth_user_id → user_id → id.
--   - There is no 'reports' table. Reports are generated via SECURITY
--     DEFINER RPCs (get_daily_report, get_monthly_report) that bypass
--     RLS, so no RLS policies are needed for reports.
-- ============================================

-- ============================================
-- PART 1: FIX school_settings - Add admin policies
-- ============================================
-- PROBLEM: Only a SELECT policy existed. No UPDATE, INSERT, or DELETE
-- policies, so admin users could not save settings via the SettingsPage.

ALTER TABLE public.school_settings ENABLE ROW LEVEL SECURITY;

-- Admin-only SELECT (replaces old "all authenticated users" policy)
-- NOTE: Teachers who need school location/radius data must get it
-- through SECURITY DEFINER RPCs (check_in_with_location, etc.)
-- which bypass RLS. Direct table access is admin-only.
DROP POLICY IF EXISTS "Authenticated users read school settings" ON public.school_settings;
CREATE POLICY "Admins read school settings"
  ON public.school_settings FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- Admin-only INSERT
DROP POLICY IF EXISTS "Admins insert school settings" ON public.school_settings;
CREATE POLICY "Admins insert school settings"
  ON public.school_settings FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

-- Admin-only UPDATE
DROP POLICY IF EXISTS "Admins update school settings" ON public.school_settings;
CREATE POLICY "Admins update school settings"
  ON public.school_settings FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Admin-only DELETE
DROP POLICY IF EXISTS "Admins delete school settings" ON public.school_settings;
CREATE POLICY "Admins delete school settings"
  ON public.school_settings FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ============================================
-- PART 2: FIX attendance_notifications - Teacher policy
-- ============================================
-- PROBLEM: "Teachers read own notifications" used
--   teacher_id = auth.uid()
-- This is WRONG because teacher_id references teachers.id,
-- NOT auth.users.id. The correct check is:
--   public.is_teacher_owner(teacher_id)

DROP POLICY IF EXISTS "Teachers read own notifications" ON attendance_notifications;

CREATE POLICY "Teachers read own notifications"
  ON attendance_notifications FOR SELECT
  TO authenticated
  USING (public.is_teacher_owner(teacher_id));

-- ============================================
-- PART 3: ADD INDEXES FOR POLICY PERFORMANCE
-- ============================================
-- The is_admin() function queries: WHERE ... AND role = 'admin'
-- Without an index, this is a sequential scan on every policy check.

CREATE INDEX IF NOT EXISTS idx_teachers_role ON public.teachers(role);

-- ============================================
-- PART 4: CLEANUP - Drop any legacy JWT-metadata policies
-- that may have survived previous migrations
-- ============================================

-- These old policies used auth.jwt() and were supposed to be
-- replaced by migration 00019, but their DROP may have been
-- skipped if a DO block guard didn't fire. Clean them up.

DROP POLICY IF EXISTS "Admins read all teachers (deprecated)" ON teachers;
DROP POLICY IF EXISTS "Admins manage school holidays (deprecated)" ON school_holidays;

-- ============================================
-- PART 5: VERIFICATION QUERIES
-- Run these in Supabase SQL Editor:
--
--   -- List all policies with their definitions
--   SELECT schemaname, tablename, policyname, cmd, qual
--   FROM pg_policies
--   WHERE schemaname = 'public'
--   ORDER BY tablename, cmd;
--
--   -- Verify no JWT metadata references remain
--   SELECT schemaname, tablename, policyname
--   FROM pg_policies
--   WHERE schemaname = 'public'
--     AND (qual::text LIKE '%jwt%' OR with_check::text LIKE '%jwt%')
--     AND policyname NOT LIKE '%deprecated%';
--   -- Expected: empty result
--
--   -- Verify teacher identity chain consistency
--   SELECT id, email, role, user_id, auth_user_id
--   FROM public.teachers
--   ORDER BY created_at;
-- ============================================
