-- ============================================
-- JK Attendance - Migration 00059
-- FIX: Fail-closed JWT secret for verify_role_change_token & update_teacher_role
-- ============================================
-- WHY:
--   Migration 00055 introduced `verify_role_change_token()` and
--   `update_teacher_role()`, both of which read
--   `current_setting('app.settings.jwt_secret', true)`. Because managed
--   Supabase disallows ALTER DATABASE for custom GUC parameters without
--   superuser privileges, the GUC is unset and role updates fail.
--
--   The previous revision of this migration embedded a hardcoded fallback
--   secret directly in the migration SQL. That is a privilege-escalation
--   vulnerability: the secret is the HMAC key that gates the
--   `trg_teachers_role_immutable` trigger, so anyone who can read the
--   migration (any repo collaborator, any fork, any log) can forge a valid
--   `app.role_change_token` and bypass the trigger with a direct UPDATE.
--
-- FIX:
--   Both functions now FAIL CLOSED when the GUC is unset. There is no
--   hardcoded fallback. The secret must be set out-of-band at deploy time
--   via the Supabase secrets mechanism (e.g. `supabase secrets set`), which
--   injects it into the database configuration without ever writing it to
--   a migration file or client code.
--
--   The functions remain SECURITY DEFINER with fixed search_path, preserving
--   all superadmin authorization checks, audit logging, and trigger immunity.
-- ============================================

-- --------------------------------------------
-- 1. Helper: verify the transaction-local HMAC token
--    SECURITY DEFINER so it can read app.settings.jwt_secret
--    FAILS CLOSED: returns FALSE when the secret is not configured.
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_role_change_token(p_token TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_user_id TEXT;
  v_jwt_secret TEXT;
  v_expected TEXT;
BEGIN
  IF p_token IS NULL OR p_token = '' THEN
    RETURN FALSE;
  END IF;

  v_user_id := current_setting('request.jwt.claims', true)::json->>'sub';
  IF v_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Fail closed: no hardcoded fallback. If the GUC is unset the role-change
  -- mechanism is disabled rather than weakened.
  v_jwt_secret := current_setting('app.settings.jwt_secret', true);
  IF v_jwt_secret IS NULL OR v_jwt_secret = '' THEN
    RAISE WARNING 'verify_role_change_token: app.settings.jwt_secret not configured';
    RETURN FALSE;
  END IF;

  v_expected := encode(
    digest(v_user_id || ':' || v_jwt_secret, 'sha256'),
    'hex'
  );

  RETURN v_token = v_expected;
END;
$function$;

-- --------------------------------------------
-- 2. Updated RPC: sets the trusted token before updating
--    All original guards preserved. FAILS CLOSED on missing secret.
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
  v_user_id TEXT;
  v_jwt_secret TEXT;
  v_token TEXT;
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

  -- Transaction-local trusted context: proves this UPDATE originates
  -- from the sanctioned SECURITY DEFINER RPC, not a direct client write.
  v_user_id := current_setting('request.jwt.claims', true)::json->>'sub';
  v_jwt_secret := current_setting('app.settings.jwt_secret', true);

  -- Fail closed: the secret must be configured out-of-band. There is no
  -- hardcoded fallback, so a missing secret disables role changes rather
  -- than weakening the trigger's HMAC gate.
  IF v_jwt_secret IS NULL OR v_jwt_secret = '' THEN
    RAISE EXCEPTION 'app.settings.jwt_secret not configured. Set it out-of-band before using update_teacher_role().'
      USING ERRCODE = '42501';
  END IF;

  v_token := encode(
    digest(v_user_id || ':' || v_jwt_secret, 'sha256'),
    'hex'
  );
  PERFORM set_config('app.role_change_token', v_token, true);

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

-- --------------------------------------------
-- 3. Preserve EXECUTE grants (unchanged from 00053/00055)
-- --------------------------------------------
REVOKE EXECUTE ON FUNCTION public.update_teacher_role(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_teacher_role(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_teacher_role(UUID, TEXT) TO authenticated;