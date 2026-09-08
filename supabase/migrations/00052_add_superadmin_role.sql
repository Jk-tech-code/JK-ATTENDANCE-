-- ============================================
-- JK Attendance - Migration 00052
-- Add superadmin role for admin management
-- ============================================

-- ============================================
-- 1. UPDATE role CHECK CONSTRAINT
--    Adds 'superadmin' to allowed role values
-- ============================================
ALTER TABLE public.teachers DROP CONSTRAINT IF EXISTS teachers_role_check;
ALTER TABLE public.teachers ADD CONSTRAINT teachers_role_check
  CHECK (role IN ('admin', 'teacher', 'superadmin'));

-- ============================================
-- 2. UPDATE profiles.role to allow superadmin
--    (profiles.role has no CHECK constraint but
--    we document the expected values)
-- ============================================

-- ============================================
-- 3. CREATE is_superadmin() FUNCTION
--    SECURITY DEFINER with pinned search_path
--    Checks teachers.role = 'superadmin'
-- ============================================
CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.teachers
    WHERE (id = auth.uid() OR user_id = auth.uid() OR auth_user_id = auth.uid())
      AND role = 'superadmin'
    LIMIT 1
  );
$$;

-- ============================================
-- 4. UPDATE is_admin() to also match superadmin
--    Superadmins inherit all admin privileges
-- ============================================
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.teachers
    WHERE (id = auth.uid() OR user_id = auth.uid() OR auth_user_id = auth.uid())
      AND role IN ('admin', 'superadmin')
    LIMIT 1
  );
$$;

-- ============================================
-- 5. GRANT EXECUTE to authenticated role
-- ============================================
REVOKE EXECUTE ON FUNCTION public.is_superadmin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_superadmin() TO authenticated;

-- ============================================
-- 6. PROMOTE EXISTING ADMIN TO SUPERADMIN
--    The primary admin account becomes superadmin
-- ============================================
UPDATE public.teachers
SET role = 'superadmin'
WHERE email = 'kipkemoijared855@gmail.com'
  AND role = 'admin';

-- ============================================
-- 7. VERIFY
-- ============================================
DO $$
DECLARE
  superadmin_count INT;
BEGIN
  SELECT COUNT(*) INTO superadmin_count
  FROM public.teachers
  WHERE role = 'superadmin';

  RAISE NOTICE 'Superadmin count: %', superadmin_count;
END;
$$;
