-- ============================================
-- 00050_guard_calendar_crud_rpcs.sql
-- ============================================
-- WHY:
--   create_calendar_entry, update_calendar_entry, and delete_calendar_entry
--   are SECURITY DEFINER with GRANT EXECUTE TO authenticated and no internal
--   authorization check. Because SECURITY DEFINER bypasses table RLS,
--   any authenticated teacher (not just admins) could call these RPCs
--   directly and create / update / delete calendar + holiday records.
--   The UI is admin-gated by AdminRoute, but UI gating is not defense
--   in depth; a teacher with a valid JWT could call the RPCs via the
--   REST endpoint or a modified client.
--
--   FIX: add an internal public.is_admin() guard as the first executable
--   statement in each function. Same pattern as 00037_guard_report_rpcs.sql.
--   Legitimate callers (HolidayManagementPage, CalendarPage) are admin-only,
--   so admins are unaffected. Teachers and anon now get SQLSTATE 42501 ->
--   HTTP 403 before any mutation.
--
--   auth.uid() reads the request JWT claim, which is preserved inside a
--   SECURITY DEFINER context, so is_admin() correctly evaluates the
--   CALLER's role, not the function owner's. (Same mechanism used by the
--   school_calendar / holidays table RLS policies.)
--
--   FUNCTION BODIES ARE OTHERWISE REPRODUCED VERBATIM from 00049. The
--   reconciliation logic between school_calendar and holidays, the
--   day_type validation, the duplicate (23505) handling, the delete
--   cascade, and the return shape are all preserved.
-- ============================================

-- --------------------------------------------
-- create_calendar_entry
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.create_calendar_entry(
  p_calendar_date DATE,
  p_day_type TEXT,
  p_title TEXT,
  p_description TEXT,
  p_created_by UUID
)
 RETURNS TABLE (
  id UUID,
  calendar_date DATE,
  day_type TEXT,
  title TEXT,
  description TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ
)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_id UUID;
  v_created_at TIMESTAMPTZ;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access denied: admin role required' USING ERRCODE = '42501';
  END IF;

  -- Validate day_type.
  IF p_day_type NOT IN ('working_day', 'weekend', 'holiday', 'event') THEN
    RAISE EXCEPTION 'Invalid day_type: %', p_day_type
      USING ERRCODE = '22023';
  END IF;

  -- Insert into school_calendar. The UNIQUE INDEX on calendar_date
  -- guarantees one row per date; duplicates raise 23505 and the
  -- client surfaces a friendly error.
  INSERT INTO school_calendar (calendar_date, day_type, title, description, created_by)
  VALUES (p_calendar_date, p_day_type, p_title, p_description, p_created_by)
  RETURNING school_calendar.id, school_calendar.created_at
    INTO v_id, v_created_at;

  -- Keep the denormalized holidays cache in sync. Only insert when
  -- the entry is a holiday or event (those are the only day_types
  -- that appear in holidays). onConflict DO NOTHING preserves
  -- existing rows.
  IF p_day_type IN ('holiday', 'event') THEN
    INSERT INTO holidays (title, description, holiday_date, type)
    VALUES (p_title, p_description, p_calendar_date, p_day_type)
    ON CONFLICT (holiday_date, type) DO NOTHING;
  END IF;

  RETURN QUERY
    SELECT sc.id, sc.calendar_date, sc.day_type, sc.title, sc.description,
           sc.created_by, sc.created_at
    FROM school_calendar sc
    WHERE sc.id = v_id;
END;
$function$;

-- --------------------------------------------
-- update_calendar_entry
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.update_calendar_entry(
  p_id UUID,
  p_calendar_date DATE,
  p_day_type TEXT,
  p_title TEXT,
  p_description TEXT
)
 RETURNS TABLE (
  id UUID,
  calendar_date DATE,
  day_type TEXT,
  title TEXT,
  description TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ
)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_old_date DATE;
  v_old_day_type TEXT;
  v_updated_at TIMESTAMPTZ;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access denied: admin role required' USING ERRCODE = '42501';
  END IF;

  -- Validate day_type if provided.
  IF p_day_type IS NOT NULL
     AND p_day_type NOT IN ('working_day', 'weekend', 'holiday', 'event') THEN
    RAISE EXCEPTION 'Invalid day_type: %', p_day_type
      USING ERRCODE = '22023';
  END IF;

  -- Snapshot the old date/type so we can clean the holidays cache.
  SELECT sc.calendar_date, sc.day_type
    INTO v_old_date, v_old_day_type
  FROM school_calendar sc
  WHERE sc.id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Calendar entry not found: %', p_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Apply the update. The unique index on calendar_date raises 23505
  -- on a date collision; the client surfaces that as a friendly
  -- "already exists" error.
  UPDATE school_calendar sc
    SET calendar_date = COALESCE(p_calendar_date, sc.calendar_date),
        day_type      = COALESCE(p_day_type,      sc.day_type),
        title         = COALESCE(p_title,         sc.title),
        description   = COALESCE(p_description,   sc.description),
        updated_at    = now()
  WHERE sc.id = p_id
  RETURNING sc.created_at INTO v_updated_at;

  -- Reconcile holidays cache:
  -- 1) Remove the OLD (date, type) row if the day_type was a holiday/event.
  -- 2) Insert the NEW (date, type) row if the NEW day_type is a holiday/event.
  IF v_old_day_type IN ('holiday', 'event') THEN
    DELETE FROM holidays
    WHERE holiday_date = v_old_date
      AND type = v_old_day_type;
  END IF;

  IF p_day_type IN ('holiday', 'event') THEN
    INSERT INTO holidays (title, description, holiday_date, type)
    VALUES (
      COALESCE(p_title, (SELECT sc.title FROM school_calendar sc WHERE sc.id = p_id)),
      COALESCE(p_description, (SELECT sc.description FROM school_calendar sc WHERE sc.id = p_id)),
      COALESCE(p_calendar_date, v_old_date),
      p_day_type
    )
    ON CONFLICT (holiday_date, type) DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description;
  END IF;

  RETURN QUERY
    SELECT sc.id, sc.calendar_date, sc.day_type, sc.title, sc.description,
           sc.created_by, sc.created_at
    FROM school_calendar sc
    WHERE sc.id = p_id;
END;
$function$;

-- --------------------------------------------
-- delete_calendar_entry
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_calendar_entry(p_id UUID)
 RETURNS BOOLEAN
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_old_date DATE;
  v_old_day_type TEXT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access denied: admin role required' USING ERRCODE = '42501';
  END IF;

  SELECT sc.calendar_date, sc.day_type
    INTO v_old_date, v_old_day_type
  FROM school_calendar sc
  WHERE sc.id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Calendar entry not found: %', p_id
      USING ERRCODE = 'P0002';
  END IF;

  DELETE FROM school_calendar WHERE id = p_id;

  IF v_old_day_type IN ('holiday', 'event') THEN
    DELETE FROM holidays
    WHERE holiday_date = v_old_date
      AND type = v_old_day_type;
  END IF;

  RETURN TRUE;
END;
$function$;

-- EXECUTE permissions are unchanged: GRANT EXECUTE TO authenticated
-- (set in 00049). The internal is_admin() check is the authorization
-- boundary; non-admins now get SQLSTATE 42501 -> HTTP 403.
