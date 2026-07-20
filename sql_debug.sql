-- ============================================================
-- JK ATTENDANCE — Diagnostic & Repair SQL
-- Run each section in order in Supabase SQL Editor
-- ============================================================

-- ============================================================
-- STEP 1: DIAGNOSE
-- ============================================================

-- 1a. Who is the logged-in user?
SELECT id, email, raw_user_meta_data->>'role' as role, created_at
FROM auth.users
ORDER BY created_at;

-- 1b. What's in the teachers table?
SELECT id, user_id, staff_number, full_name, email, employment_status
FROM teachers
ORDER BY created_at;

-- 1c. Which teachers are linked to auth users?
SELECT
  t.id AS teacher_id,
  t.user_id,
  t.full_name,
  t.email AS teacher_email,
  u.id AS auth_user_id,
  u.email AS auth_email
FROM teachers t
LEFT JOIN auth.users u ON t.email = u.email OR t.user_id = u.id
ORDER BY t.created_at;

-- 1d. Which auth users have NO teacher profile?
SELECT u.id, u.email
FROM auth.users u
LEFT JOIN teachers t ON t.id = u.id OR t.user_id = u.id
WHERE t.id IS NULL;

-- 1e. Check RLS policies on teachers
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE tablename = 'teachers'
ORDER BY policyname;

-- 1f. Check the user_id column exists
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'teachers' AND column_name = 'user_id';

-- ============================================================
-- STEP 2: RUN MIGRATION 00017 (if not already applied)
-- ============================================================

BEGIN;

-- 2a. Add user_id column
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
CREATE INDEX IF NOT EXISTS idx_teachers_user_id ON teachers(user_id);

-- 2b. Backfill: link existing teachers to auth users by email
UPDATE teachers t
SET user_id = u.id
FROM auth.users u
WHERE t.email = u.email
  AND t.user_id IS NULL;

-- 2c. Create teacher profile for the admin (if missing)
DO $$
DECLARE
  v_admin_id UUID;
  v_exists  INTEGER;
BEGIN
  SELECT id INTO v_admin_id FROM auth.users WHERE email = 'kipkemoijared855@gmail.com';
  IF v_admin_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_exists FROM teachers WHERE user_id = v_admin_id OR id = v_admin_id;
    IF v_exists = 0 THEN
      INSERT INTO teachers (id, user_id, staff_number, full_name, email, department, phone, reporting_time, employment_status)
      VALUES (v_admin_id, v_admin_id, 'ADMIN-001', 'System Admin', 'kipkemoijared855@gmail.com', 'Administration', '+254700000000', '07:20', 'active')
      ON CONFLICT (id) DO NOTHING;
    END IF;
  END IF;
END $$;

-- 2d. Update RLS: drop old, create new that checks both id and user_id
DROP POLICY IF EXISTS "Teachers read own profile" ON teachers;
CREATE POLICY "Teachers read own profile"
  ON teachers FOR SELECT
  TO authenticated
  USING (id = auth.uid() OR user_id = auth.uid());

-- 2e. Update attendance RLS for teachers
DROP POLICY IF EXISTS "Teachers manage own attendance" ON attendance;
CREATE POLICY "Teachers manage own attendance"
  ON attendance FOR ALL
  TO authenticated
  USING (
    teacher_id IN (SELECT id FROM teachers WHERE id = auth.uid() OR user_id = auth.uid())
  )
  WITH CHECK (
    teacher_id IN (SELECT id FROM teachers WHERE id = auth.uid() OR user_id = auth.uid())
  );

COMMIT;

-- ============================================================
-- STEP 3: VERIFY REPAIRS
-- ============================================================

-- 3a. Confirm admin has a teacher profile
SELECT id, user_id, staff_number, full_name, email
FROM teachers
WHERE email = 'kipkemoijared855@gmail.com';

-- 3b. Test the query as the admin user
-- (run this with the admin's auth token or use the Supabase dashboard SQL editor as authenticated user)
-- SELECT * FROM teachers WHERE user_id = auth.uid() OR id = auth.uid();

-- 3c. Check all teachers now have user_id where possible
SELECT id, user_id, staff_number, full_name, email
FROM teachers
ORDER BY created_at;
