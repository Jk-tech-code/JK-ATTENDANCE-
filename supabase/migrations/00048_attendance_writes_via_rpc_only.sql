-- ============================================
-- JK Attendance - Migration 00048
-- SECURITY: Lock down attendance table to prevent GPS bypass
-- 
-- Bug: The existing "Teachers manage own attendance" policy was FOR ALL,
-- allowing teachers to bypass the check_in_with_location RPC and write
-- raw attendance rows with arbitrary GPS data / status.
--
-- Fix: split the policy into:
--   - SELECT: teachers see only their own attendance
--   - INSERT/UPDATE/DELETE: NOT granted to authenticated (writes go
--     through SECURITY DEFINER RPCs: check_in_with_location, etc.)
--   - Admins keep full access via the existing admin policies.
-- ============================================

-- Drop the over-permissive combined policy.
DROP POLICY IF EXISTS "Teachers manage own attendance" ON public.attendance;

-- Recreate as SELECT only. All write paths go through SECURITY DEFINER RPCs.
CREATE POLICY "Teachers read own attendance"
  ON public.attendance FOR SELECT
  TO authenticated
  USING (
    teacher_id IN (
      SELECT id FROM public.teachers
      WHERE id           = (SELECT auth.uid())
         OR user_id      = (SELECT auth.uid())
         OR auth_user_id = (SELECT auth.uid())
    )
  );

-- Defense-in-depth: explicitly revoke write privileges on attendance from
-- the authenticated role. The check_in_with_location RPC runs as
-- SECURITY DEFINER and bypasses RLS, so it retains write access.
REVOKE INSERT, UPDATE, DELETE ON public.attendance FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.attendance FROM anon;