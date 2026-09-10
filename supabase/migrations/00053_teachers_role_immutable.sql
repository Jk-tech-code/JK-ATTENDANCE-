-- ============================================
-- JK Attendance - Migration 00053
-- H3 FIX: Database-enforced teachers.role immutability
--
-- WHY:
--   RLS policy "Admins update teachers" permits ANY admin to UPDATE
--   every teachers column, including `role`. The frontend
--   updateTeacher() type omits `role`, but TypeScript is not a
--   security boundary: a crafted PostgREST request
--     PATCH /rest/v1/teachers?id=eq.<uuid>  {"role":"superadmin"}
--   with a valid *admin* JWT passes RLS (is_admin() = true) and
--   escalates privileges. 00040 closed the identical hole for
--   profiles.role via column privileges; teachers.role was left open.
--
-- FIX (defense in depth, least privilege):
--   1. Column privileges: revoke UPDATE(role) on teachers from
--      anon + authenticated. Non-role admin edits keep working;
--      any UPDATE that assigns `role` now fails with
--      "permission denied for column role", before RLS.
--   2. Trigger guard: BEFORE UPDATE trigger rejects role changes
--      for ALL direct writers, so even a future GRANT cannot
--      silently re-open escalation. Role changes must flow through
--      the audited update_teacher_role() RPC below.
--   3. Controlled RPC update_teacher_role(): the ONLY supported
--      path for role transitions. SECURITY DEFINER, pinned
--      search_path, superadmin-only (is_superadmin()), strict
--      allowlist validation, self-demotion guard, audit_logs write.
--
-- SAFETY:
--   * service_role bypasses column grants AND RLS, so
--     invite-teacher / create-admin / delete-teacher edge functions
--     are unaffected.
--   * SECURITY DEFINER trigger/RPC run with owner privileges,
--     unaffected by the authenticated column revoke.
--   * No legitimate UI writes `role` via PostgREST (TeachersPage edit
--     form has no role field; AdminManagementPage uses create-admin).
--   * Idempotent / re-runnable.
-- ============================================

-- --------------------------------------------
-- 1. Column privileges: nobody via PostgREST may write role
-- --------------------------------------------
REVOKE UPDATE (role) ON public.teachers FROM anon;
REVOKE UPDATE (role) ON public.teachers FROM authenticated;


-- --------------------------------------------
-- 2. Trigger: reject direct role mutation with a clear error
--    (belt-and-suspenders behind the column revoke)
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_teachers_role_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION
      'Access denied: teachers.role cannot be modified directly. Use update_teacher_role() as superadmin.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_teachers_role_immutable ON public.teachers;
CREATE TRIGGER trg_teachers_role_immutable
  BEFORE UPDATE OF role ON public.teachers
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_teachers_role_escalation();
-- --------------------------------------------
-- 3. Controlled RPC: superadmin-only role transitions
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.update_teacher_role(
  p_teacher_id UUID,
  p_new_role TEXT
)
RETURNS TABLE (
  id UUID,
  email TEXT,
  full_name TEXT,
  role TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_old_role TEXT;
  v_row RECORD;
BEGIN
  IF NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'Access denied: superadmin role required'
      USING ERRCODE = '42501';
  END IF;

  IF p_new_role IS NULL OR p_new_role NOT IN ('teacher', 'admin', 'superadmin') THEN
    RAISE EXCEPTION 'Invalid role: %', COALESCE(p_new_role, 'NULL')
      USING ERRCODE = '22023';
  END IF;

  SELECT t.role INTO v_old_role
  FROM public.teachers t
  WHERE t.id = p_teacher_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Teacher not found: %', p_teacher_id
      USING ERRCODE = 'P0002';
  END IF;

  IF p_teacher_id = auth.uid() AND v_old_role = 'superadmin' AND p_new_role <> 'superadmin' THEN
    RAISE EXCEPTION 'Superadmins cannot demote their own account'
      USING ERRCODE = '42501';
  END IF;

  IF v_old_role = p_new_role THEN
    RETURN QUERY
      SELECT t.id, t.email, t.full_name, t.role
      FROM public.teachers t
      WHERE t.id = p_teacher_id;
    RETURN;
  END IF;

  UPDATE public.teachers t
  SET role = p_new_role,
      updated_at = now()
  WHERE t.id = p_teacher_id
  RETURNING t.id, t.email, t.full_name, t.role
  INTO v_row;

  BEGIN
    INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, old_data, new_data)
    VALUES (
      auth.uid(),
      'UPDATE',
      'teachers.role',
      p_teacher_id,
      jsonb_build_object('role', v_old_role),
      jsonb_build_object('role', p_new_role)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'update_teacher_role: audit log write failed: %', SQLERRM;
  END;

  RETURN QUERY
    SELECT v_row.id, v_row.email, v_row.full_name, v_row.role;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.update_teacher_role(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_teacher_role(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_teacher_role(UUID, TEXT) TO authenticated;

-- Verify (run manually after push):
--   SELECT grantee, privilege_type, column_name
--   FROM information_schema.role_column_grants
--   WHERE table_schema='public' AND table_name='teachers'
--     AND column_name='role' AND privilege_type='UPDATE'
--   ORDER BY 1;
--   -- expect: no rows for anon / authenticated.


