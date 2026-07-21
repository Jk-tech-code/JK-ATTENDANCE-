-- ============================================
-- JK Attendance - Migration 00031
-- Fix RLS policies and add role column to teachers
-- ============================================

-- ============================================
-- 1. ADD role COLUMN TO teachers
-- ============================================
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'teacher';

-- Update the check constraint to include 'admin'
ALTER TABLE teachers DROP CONSTRAINT IF EXISTS teachers_role_check;
ALTER TABLE teachers ADD CONSTRAINT teachers_role_check
  CHECK (role IN ('admin', 'teacher'));

-- ============================================
-- 2. CREATE SECURE is_admin() FUNCTION
-- Uses SECURITY DEFINER to bypass RLS recursion.
-- ============================================
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM teachers
    WHERE user_id = auth.uid()
      AND role = 'admin'
    LIMIT 1
  );
$$;

-- ============================================
-- 3. FIX TEACHERS RLS POLICIES
-- ============================================

-- Fix "Teachers read own profile" — check user_id not id
DROP POLICY IF EXISTS "Teachers read own profile" ON teachers;
CREATE POLICY "Teachers read own profile"
  ON teachers FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Replace all admin policies with is_admin() function
DROP POLICY IF EXISTS "Admins read all teachers" ON teachers;
CREATE POLICY "Admins read all teachers"
  ON teachers FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins insert teachers" ON teachers;
CREATE POLICY "Admins insert teachers"
  ON teachers FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins update teachers" ON teachers;
CREATE POLICY "Admins update teachers"
  ON teachers FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins delete teachers" ON teachers;
CREATE POLICY "Admins delete teachers"
  ON teachers FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ============================================
-- 4. FIX ATTENDANCE RLS POLICIES
-- ============================================

DROP POLICY IF EXISTS "Teachers manage own attendance" ON attendance;
CREATE POLICY "Teachers manage own attendance"
  ON attendance FOR ALL
  TO authenticated
  USING (
    teacher_id IN (SELECT id FROM teachers WHERE user_id = auth.uid())
  )
  WITH CHECK (
    teacher_id IN (SELECT id FROM teachers WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Admins read all attendance" ON attendance;
CREATE POLICY "Admins read all attendance"
  ON attendance FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- ============================================
-- 5. FIX SCHOOL_HOLIDAYS RLS POLICIES
-- ============================================

DROP POLICY IF EXISTS "Admins manage school holidays" ON school_holidays;
CREATE POLICY "Admins manage school holidays"
  ON school_holidays FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ============================================
-- 6. FIX SCHOOL_CALENDAR RLS POLICIES
-- ============================================

DROP POLICY IF EXISTS "Admins insert school_calendar" ON school_calendar;
CREATE POLICY "Admins insert school_calendar"
  ON school_calendar FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins update school_calendar" ON school_calendar;
CREATE POLICY "Admins update school_calendar"
  ON school_calendar FOR UPDATE
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins delete school_calendar" ON school_calendar;
CREATE POLICY "Admins delete school_calendar"
  ON school_calendar FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ============================================
-- 7. SET FIRST USER AS ADMIN (seed)
-- ============================================
-- Sets the first user in the teachers table as admin.
-- This is a safe seed for fresh deployments.
UPDATE teachers
SET role = 'admin'
WHERE id = (
  SELECT id FROM teachers ORDER BY created_at ASC LIMIT 1
);
