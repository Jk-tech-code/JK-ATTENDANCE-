-- ============================================
-- JK Attendance - Migration 00033
-- Fix is_admin() function and link admin auth user
-- ============================================

-- ============================================
-- 1. FIX is_admin() to check all ID columns
--    (id, user_id, auth_user_id) - same pattern
--    used by is_teacher_owner() and all RLS policies
-- ============================================
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.teachers
    WHERE (id = auth.uid() OR user_id = auth.uid() OR auth_user_id = auth.uid())
      AND role = 'admin'
    LIMIT 1
  );
$$;

-- ============================================
-- 2. LINK EXISTING TEACHERS TO AUTH USERS
--    Sets auth_user_id by matching email
-- ============================================
UPDATE public.teachers t
SET auth_user_id = u.id
FROM auth.users u
WHERE t.email = u.email
  AND t.auth_user_id IS NULL;

-- ============================================
-- 3. FIX THE ADMIN TEACHER RECORD
--    Ensures 'role' = 'admin' (in case it was
--    set to 'teacher' by ALTER TABLE default)
--    and ensures auth_user_id is set
-- ============================================
UPDATE public.teachers t
SET role = 'admin',
    auth_user_id = COALESCE(t.auth_user_id, (
      SELECT u.id FROM auth.users u WHERE u.email = t.email LIMIT 1
    ))
WHERE t.email = 'kipkemoijared855@gmail.com'
  AND (
    t.role IS DISTINCT FROM 'admin'
    OR t.auth_user_id IS NULL
  );

-- ============================================
-- 4. VERIFY
-- ============================================
DO $$
DECLARE
  admin_count INT;
  auth_link_count INT;
BEGIN
  SELECT COUNT(*) INTO admin_count
  FROM public.teachers
  WHERE email = 'kipkemoijared855@gmail.com'
    AND role = 'admin'
    AND auth_user_id IS NOT NULL;

  SELECT COUNT(*) INTO auth_link_count
  FROM public.teachers
  WHERE auth_user_id IS NOT NULL;

  RAISE NOTICE 'Admin properly configured: %', admin_count > 0;
  RAISE NOTICE 'Teachers linked to auth: %', auth_link_count;
END;
$$;
