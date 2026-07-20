-- ============================================
-- JK Attendance - Migration 00017
-- Add user_id column to link teachers to auth.users
-- ============================================

-- 1. ADD user_id COLUMN
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_teachers_user_id ON teachers(user_id);

-- 2. BACKFILL: Link existing teachers to auth users by matching email
UPDATE teachers t
SET user_id = u.id
FROM auth.users u
WHERE t.email = u.email
  AND t.user_id IS NULL;

-- 3. CREATE teacher profile for admin user (if missing)
-- Replace the email below with the actual admin email
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

-- 4. UPDATE RLS POLICIES

-- Drop old policy
DROP POLICY IF EXISTS "Teachers read own profile" ON teachers;

-- Create new policy that checks BOTH id and user_id
CREATE POLICY "Teachers read own profile"
  ON teachers FOR SELECT
  TO authenticated
  USING (
    id = auth.uid() OR user_id = auth.uid()
  );

-- ALSO update the attendance policy to match (teacher_id may still be the teachers.id)
-- Drop old policy
DROP POLICY IF EXISTS "Teachers manage own attendance" ON attendance;

-- Re-create with user_id support: teachers can manage their attendance if teacher_id matches their id OR user_id
CREATE POLICY "Teachers manage own attendance"
  ON attendance FOR ALL
  TO authenticated
  USING (
    teacher_id IN (
      SELECT id FROM teachers WHERE id = auth.uid() OR user_id = auth.uid()
    )
  )
  WITH CHECK (
    teacher_id IN (
      SELECT id FROM teachers WHERE id = auth.uid() OR user_id = auth.uid()
    )
  );

-- 5. VERIFY THE MIGRATION
-- Run these manually:
-- SELECT id, user_id, staff_number, full_name, email FROM teachers ORDER BY created_at;
-- SELECT * FROM teachers WHERE email = 'kipkemoijared855@gmail.com';
