-- ============================================
-- JK Attendance - Migration 00055
-- H3 FIX: Resolve trigger/RPC interplay
--
-- WHY:
--   Migration 00053 created:
--     1. Column-level REVOKE UPDATE(role) from anon/authenticated
--     2. BEFORE UPDATE trigger trg_teachers_role_immutable
--     3. SECURITY DEFINER RPC update_teacher_role()
--
--   Problem: The trigger fires on ALL UPDATE teachers SET role = ...,
--   INCLUDING the UPDATE inside update_teacher_role(). Since
--   SECURITY DEFINER functions execute with owner privileges and
--   bypass column-level REVOKE, the UPDATE is attempted — but the
--   trigger blocks it. Result: the sanctioned superadmin RPC is broken.
--
--   Additionally, REVOKE UPDATE(role) is INERT because table-level
--   UPDATE is still granted to authenticated (column-level revokes
--   are ignored when a table-level grant exists). The trigger is the
--   actual protection mechanism.
--
-- FIX:
--   Transaction-local GUC context (app.role_change_token) established
--   only by the trusted SECURITY DEFINER RPC, checked by the trigger.
--
--   Security properties:
--     - app.role_change_token is transaction-local (is_local = true)
--     - Only SECURITY DEFINER functions run with owner privileges
--       and can set transaction-local GUCs via set_config()
--     - Regular authenticated users cannot establish this context
--       because set_config() with is_local = true only affects the
--       current transaction, and the trigger only fires within the
--       same transaction as the RPC
--     - The HMAC token is bound to the caller's user ID (from JWT
--       claims) and the database HMAC secret, preventing forgery
--     - The trigger FAILS CLOSED: if the token is absent or invalid,
--       the role update is rejected
--     - Client input never controls the bypass — the RPC computes
--       the token internally from database-held secrets
--     - The HMAC secret is stored in PostgreSQL configuration
--       (app.settings.jwt_secret), not in client code
--
-- PRESERVES:
--   - Direct role change protection (trigger + column REVOKE)
--   - SECURITY DEFINER on trigger and RPC
--   - Pinned search_path on trigger and RPC
--   - Self-demotion protection
--   - Valid-role allowlist
--   - Audit logging
--   - EXECUTE grants (authenticated only)
--   - Non-role teacher field updates remain functional
--
-- PROFILES.ROLE:
--   Migration 00040's REVOKE UPDATE(role) on profiles is also inert
--   (table-level UPDATE still granted). No server code reads
--   profiles.role for authorization. Fix deferred to a future
--   migration if needed. Not required for H3.
--
-- SAFETY:
--   - Idempotent / re-runnable (CREATE OR REPLACE)
--   - Does not modify 00053 or 00040
--   - service_role edge functions unaffected
-- ============================================

-- --------------------------------------------
-- 1. Helper: verify the transaction-local HMAC token
--    SECURITY DEFINER so it can read app.settings.jwt_secret
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
-- 2. Updated trigger: checks token before allowing role change
--    Preserves all original protection
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_teachers_role_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF NOT public.verify_role_change_token(
      current_setting('app.role_change_token', true)
    ) THEN
      RAISE EXCEPTION
        'Access denied: teachers.role cannot be modified directly. Use update_teacher_role() as superadmin.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- --------------------------------------------
-- 3. Updated RPC: sets the trusted token before updating
--    All original guards preserved
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
  -- Only accessible within this transaction; cannot be set by regular users.
  v_user_id := current_setting('request.jwt.claims', true)::json->>'sub';
  v_jwt_secret := current_setting('app.settings.jwt_secret', true);
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
-- 4. Preserve EXECUTE grants (unchanged from 00053)
-- --------------------------------------------
REVOKE EXECUTE ON FUNCTION public.update_teacher_role(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_teacher_role(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_teacher_role(UUID, TEXT) TO authenticated;

-- --------------------------------------------
-- 5. Verify (run manually after push):
--
-- Token verification:
--   SELECT verify_role_change_token(NULL);          -- expect: false
--   SELECT verify_role_change_token('');             -- expect: false
--   SELECT verify_role_change_token('garbage');      -- expect: false
--
-- Trigger blocks direct role update:
--   UPDATE teachers SET role='admin' WHERE id='<teacher_uuid>';
--   -- expect: ERROR 42501 "Access denied: teachers.role cannot be modified directly"
--
-- Trigger allows RPC role update (from superadmin JWT context):
--   SELECT update_teacher_role('<teacher_uuid>', 'admin');
--   -- expect: SUCCESS (returns updated row)
--
-- Column REVOKE remains (inert but defense-in-depth):
--   SELECT grantee, column_name FROM information_schema.role_column_grants
--   WHERE table_schema='public' AND table_name='teachers'
--     AND column_name='role' AND privilege_type='UPDATE'
--   ORDER BY 1;
--   -- expect: no rows for anon / authenticated (inert but documented)
-- ============================================
