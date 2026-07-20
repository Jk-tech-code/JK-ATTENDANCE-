-- ==============================================
-- STEP 1: INVESTIGATION — Run these queries in Supabase SQL Editor
-- ==============================================

-- 1a. Find your auth user and its metadata
SELECT id, email, raw_user_meta_data, raw_app_meta_data, created_at
FROM auth.users
WHERE email = 'kipkemoijared855@gmail.com';

-- 1b. Check all teacher records
SELECT id, staff_number, full_name, email, employment_status
FROM teachers
ORDER BY created_at;

-- 1c. Check if ANY teacher row matches your auth UID
-- (copy the id from 1a and paste below)
SELECT * FROM teachers WHERE id = '<paste-auth-uid-here>';

-- 1d. Check RLS policies on teachers table
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE tablename = 'teachers';

-- ==============================================
-- STEP 2: FIX (choose ONE option below)
-- ==============================================

-- OPTION A: If you want ADMIN access (/admin dashboard)
-- This sets your user_metadata.role so LoginPage redirects you to /admin
UPDATE auth.users
SET raw_user_meta_data = 
  CASE 
    WHEN raw_user_meta_data IS NULL OR raw_user_meta_data = '{}'::jsonb 
    THEN '{"role":"admin"}'::jsonb
    ELSE raw_user_meta_data || '{"role":"admin"}'::jsonb
  END
WHERE email = 'kipkemoijared855@gmail.com';

-- Verify the update
SELECT id, email, raw_user_meta_data->>'role' as role
FROM auth.users
WHERE email = 'kipkemoijared855@gmail.com';

-- OPTION B: If you need a TEACHER PROFILE for dashboard
-- Replace <auth-uid> with the id from query 1a
INSERT INTO teachers (id, staff_number, full_name, email, department, phone, reporting_time, employment_status)
VALUES ('<auth-uid>', 'ADMIN-001', 'System Admin', 'kipkemoijared855@gmail.com', 'Administration', '+254700000000', '07:20', 'active')
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  full_name = EXCLUDED.full_name;

-- Verify the insert
SELECT * FROM teachers WHERE email = 'kipkemoijared855@gmail.com';

-- OPTION C: If existing teachers have random UUIDs in id column
-- (they were created without setting id = auth.uid())
-- You need to either:
--   C1: Update each teacher's id to match their auth user id
--   C2: Or add a user_id column
-- C2 is safer (doesn't break FK references):

ALTER TABLE teachers ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

-- Update user_id for existing teachers (match by email)
UPDATE teachers t
SET user_id = u.id
FROM auth.users u
WHERE t.email = u.email;

-- Update RLS to use user_id instead of id
DROP POLICY IF EXISTS "Teachers read own profile" ON teachers;
CREATE POLICY "Teachers read own profile"
  ON teachers FOR SELECT
  TO authenticated
  USING (
    id = auth.uid() OR user_id = auth.uid()
  );

-- Verify
SELECT t.id, t.user_id, t.staff_number, t.full_name, t.email
FROM teachers t
LEFT JOIN auth.users u ON t.email = u.email
ORDER BY t.created_at;
