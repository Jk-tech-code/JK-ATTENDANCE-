-- ============================================
-- JK Attendance - Migration 00019
-- Eliminate all JWT metadata references from RLS
-- Replace with secure database role lookups
-- ============================================

-- ============================================
-- PART 1: Add role column to teachers table
-- ============================================
-- WHY: Previously, admin status was read from auth.jwt()->'user_metadata'->>'role'.
-- JWT metadata is mutable by the client and can become stale.
-- Instead, we store the role in the teachers table itself, which is the
-- authoritative source and can only be changed via direct DB write.
-- ============================================

ALTER TABLE teachers ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'teacher';

COMMENT ON COLUMN teachers.role IS 'authoritative role used by RLS policies — never read from JWT claims';

-- Set admin role for the known admin user (idempotent — matches existing admin by email)
UPDATE teachers
SET role = 'admin'
WHERE email = 'kipkemoijared855@gmail.com'
  AND role = 'teacher';

-- If no teacher record exists for the admin yet, ensure admin teacher record exists
-- and has role = 'admin' (idempotent)
INSERT INTO teachers (id, user_id, auth_user_id, staff_number, full_name, email, role)
SELECT u.id, u.id, u.id, 'ADMIN-001', 'System Admin', 'kipkemoijared855@gmail.com', 'admin'
FROM auth.users u
WHERE u.email = 'kipkemoijared855@gmail.com'
  AND NOT EXISTS (
    SELECT 1 FROM teachers t
    WHERE t.email = 'kipkemoijared855@gmail.com'
  )
ON CONFLICT (id) DO UPDATE SET role = 'admin'
WHERE teachers.role = 'teacher';

-- ============================================
-- PART 2: Helper function — is_admin()
-- ============================================
-- WHY: Provides a single, secure, authoratitative check for admin role.
-- SECURITY DEFINER: runs as function owner (super admin), bypassing RLS
--   so it can read the teachers table even when RLS restricts the caller.
-- STABLE: tells the planner the function returns consistent results within
--   a statement (it depends only on auth.uid(), not on data that changes mid-query).
-- SET search_path = '': prevents search-path hijacking attacks.
-- Uses auth.uid() exclusively — never reads JWT claims.
-- ============================================

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.teachers
    WHERE (id = auth.uid() OR user_id = auth.uid() OR auth_user_id = auth.uid())
      AND role = 'admin'
  );
$$;

COMMENT ON FUNCTION public.is_admin() IS 'Returns true if the current user has role=admin in the teachers table. Bypasses RLS via SECURITY DEFINER. Never reads JWT claims.';

-- ============================================
-- PART 3: Helper function — is_teacher_owner(teacher_id UUID)
-- ============================================
-- WHY: Checks whether the current auth user "owns" a given teacher record.
-- Used by attendance policies to verify a teacher can only access their own records.
-- Optimized as a single EXISTS query with OR conditions across all link columns.
-- ============================================

CREATE OR REPLACE FUNCTION public.is_teacher_owner(check_teacher_id UUID)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.teachers
    WHERE id = check_teacher_id
      AND (id = auth.uid() OR user_id = auth.uid() OR auth_user_id = auth.uid())
  );
$$;

COMMENT ON FUNCTION public.is_teacher_owner(UUID) IS 'Returns true if the current user is linked to the given teacher id via id, user_id, or auth_user_id. SECURITY DEFINER.';

-- ============================================
-- PART 4: Rewrite ALL policies on `teachers`
-- ============================================

-- ---------- teachers: SELECT ----------

-- INSECURE (old): auth.jwt() -> 'user_metadata' ->> 'role' = 'admin'
-- WHY FLAGGED: Reads role from JWT metadata, which is client-mutable and stale.
DROP POLICY IF EXISTS "Admins read all teachers" ON teachers;

CREATE POLICY "Admins read all teachers"
  ON teachers FOR SELECT
  TO authenticated
  USING (public.is_admin());

COMMENT ON POLICY "Admins read all teachers" ON teachers IS 'Replaced auth.jwt()->user_metadata->role with public.is_admin() DB lookup.';

-- ---------- teachers: INSERT ----------

-- INSECURE (old): auth.jwt() -> 'user_metadata' ->> 'role' = 'admin'
DROP POLICY IF EXISTS "Admins insert teachers" ON teachers;

CREATE POLICY "Admins insert teachers"
  ON teachers FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

COMMENT ON POLICY "Admins insert teachers" ON teachers IS 'Replaced auth.jwt() role check with public.is_admin().';

-- ---------- teachers: UPDATE ----------

-- INSECURE (old): auth.jwt() -> 'user_metadata' ->> 'role' = 'admin'
DROP POLICY IF EXISTS "Admins update teachers" ON teachers;

CREATE POLICY "Admins update teachers"
  ON teachers FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

COMMENT ON POLICY "Admins update teachers" ON teachers IS 'Replaced auth.jwt() role check with public.is_admin().';

-- ---------- teachers: DELETE ----------

-- INSECURE (old): auth.jwt() -> 'user_metadata' ->> 'role' = 'admin'
DROP POLICY IF EXISTS "Admins delete teachers" ON teachers;

CREATE POLICY "Admins delete teachers"
  ON teachers FOR DELETE
  TO authenticated
  USING (public.is_admin());

COMMENT ON POLICY "Admins delete teachers" ON teachers IS 'Replaced auth.jwt() role check with public.is_admin().';

-- ============================================
-- PART 5: Rewrite ALL policies on `attendance`
-- ============================================

-- ---------- attendance: SELECT (admin) ----------

-- INSECURE (old): auth.jwt() -> 'user_metadata' ->> 'role' = 'admin'
-- ALSO INSECURE (old variant): EXISTS (SELECT 1 FROM auth.users WHERE raw_user_meta_data->>'role' = 'admin')
-- WHY FLAGGED: Both variants read role from auth metadata instead of database table.
DROP POLICY IF EXISTS "Admins read all attendance" ON attendance;

CREATE POLICY "Admins read all attendance"
  ON attendance FOR SELECT
  TO authenticated
  USING (public.is_admin());

COMMENT ON POLICY "Admins read all attendance" ON attendance IS 'Replaced auth.users.raw_user_meta_data check with public.is_admin().';

-- ---------- attendance: ALL (teacher own) ----------
-- This policy already uses auth.uid() exclusively — no JWT metadata.
-- It already exists from migration 00018. We just DROP+CREATE for idempotency.
DROP POLICY IF EXISTS "Teachers manage own attendance" ON attendance;

CREATE POLICY "Teachers manage own attendance"
  ON attendance FOR ALL
  TO authenticated
  USING (public.is_teacher_owner(teacher_id))
  WITH CHECK (public.is_teacher_owner(teacher_id));

COMMENT ON POLICY "Teachers manage own attendance" ON attendance IS 'Uses public.is_teacher_owner() helper with auth.uid() — no JWT metadata.';

-- ============================================
-- PART 6: Rewrite ALL policies on `school_holidays`
-- ============================================

-- INSECURE (old): auth.jwt() -> 'user_metadata' ->> 'role' = 'admin'
-- AND: EXISTS (SELECT 1 FROM auth.users WHERE raw_user_meta_data->>'role' = 'admin')
DROP POLICY IF EXISTS "Admins manage school holidays" ON school_holidays;

CREATE POLICY "Admins manage school holidays"
  ON school_holidays FOR ALL
  TO authenticated
  USING (public.is_admin());

COMMENT ON POLICY "Admins manage school holidays" ON school_holidays IS 'Replaced JWT metadata and auth.users.raw_user_meta_data checks with public.is_admin().';

-- The "Authenticated users read school holidays" policy uses USING(true) — no issue.
-- Kept as-is.

-- ============================================
-- PART 7: Rewrite ALL policies on `attendance_notifications`
-- ============================================

-- INSECURE (old): EXISTS (SELECT 1 FROM auth.users WHERE raw_user_meta_data->>'role' = 'admin')
DROP POLICY IF EXISTS "Admins read notifications" ON attendance_notifications;

CREATE POLICY "Admins read notifications"
  ON attendance_notifications FOR SELECT
  TO authenticated
  USING (public.is_admin());

COMMENT ON POLICY "Admins read notifications" ON attendance_notifications IS 'Replaced auth.users.raw_user_meta_data check with public.is_admin().';

-- INSECURE (old): EXISTS (SELECT 1 FROM auth.users WHERE raw_user_meta_data->>'role' = 'admin')
DROP POLICY IF EXISTS "Admins insert notifications" ON attendance_notifications;

CREATE POLICY "Admins insert notifications"
  ON attendance_notifications FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

COMMENT ON POLICY "Admins insert notifications" ON attendance_notifications IS 'Replaced auth.users.raw_user_meta_data check with public.is_admin().';

-- "Teachers read own notifications" uses teacher_id = auth.uid() — no issue.
-- Kept as-is.

-- ============================================
-- PART 8: Rewrite ALL policies on `school_calendar`
-- ============================================

-- INSECURE (old): EXISTS (SELECT 1 FROM auth.users WHERE raw_user_meta_data->>'role' = 'admin')
DROP POLICY IF EXISTS "Admins insert school_calendar" ON school_calendar;

CREATE POLICY "Admins insert school_calendar"
  ON school_calendar FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

COMMENT ON POLICY "Admins insert school_calendar" ON school_calendar IS 'Replaced auth.users.raw_user_meta_data check with public.is_admin().';

-- INSECURE (old): EXISTS (SELECT 1 FROM auth.users WHERE raw_user_meta_data->>'role' = 'admin')
DROP POLICY IF EXISTS "Admins update school_calendar" ON school_calendar;

CREATE POLICY "Admins update school_calendar"
  ON school_calendar FOR UPDATE
  TO authenticated
  USING (public.is_admin());

COMMENT ON POLICY "Admins update school_calendar" ON school_calendar IS 'Replaced auth.users.raw_user_meta_data check with public.is_admin().';

-- INSECURE (old): EXISTS (SELECT 1 FROM auth.users WHERE raw_user_meta_data->>'role' = 'admin')
DROP POLICY IF EXISTS "Admins delete school_calendar" ON school_calendar;

CREATE POLICY "Admins delete school_calendar"
  ON school_calendar FOR DELETE
  TO authenticated
  USING (public.is_admin());

COMMENT ON POLICY "Admins delete school_calendar" ON school_calendar IS 'Replaced auth.users.raw_user_meta_data check with public.is_admin().';

-- ============================================
-- PART 9: Rewrite ALL policies on `audit_logs`
-- ============================================

-- INSECURE (old): auth.jwt() -> 'user_metadata' ->> 'role' = 'admin'
DROP POLICY IF EXISTS "Admins read audit logs" ON audit_logs;

CREATE POLICY "Admins read audit logs"
  ON audit_logs FOR SELECT
  TO authenticated
  USING (public.is_admin());

COMMENT ON POLICY "Admins read audit logs" ON audit_logs IS 'Replaced auth.jwt() role check with public.is_admin().';

-- ============================================
-- PART 10: Verify the migration
-- ============================================
-- Run the following queries to verify:
-- 1. SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
--    FROM pg_policies
--    WHERE tablename IN ('teachers','attendance','school_holidays','school_settings','attendance_notifications','school_calendar','audit_logs')
--    ORDER BY tablename, policyname;
-- 2. SELECT public.is_admin();  -- should return true for admin user, false for others
-- 3. SELECT id, email, role, user_id, auth_user_id FROM teachers ORDER BY created_at;
