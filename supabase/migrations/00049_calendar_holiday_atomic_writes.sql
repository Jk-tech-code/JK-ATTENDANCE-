-- ============================================
-- JK Attendance - Migration 00049
-- Fix two-table drift: atomic calendar/holiday writes
-- ============================================
-- Problem: services/calendar.ts::createCalendarEntry inserts into
-- school_calendar, then upserts into holidays. The second write
-- is best-effort and silently swallows errors (console.warn), so the
-- two tables can drift. Worse, if the school_calendar insert fails
-- the holidays row is still written.
--
-- Fix: a single SECURITY DEFINER RPC that writes both tables in one
-- transaction with a uniqueness check on (calendar_date) in
-- school_calendar (the existing UNIQUE INDEX uq_school_calendar_date).
-- The holidays table is denormalized cache used by get_month_calendar;
-- the trigger after the RPC keeps it in sync.

-- ─── RPC: create_calendar_entry ──────────────────────────────
-- Inserts into school_calendar and upserts into holidays atomically.
-- Returns the new school_calendar row.
CREATE OR REPLACE FUNCTION create_calendar_entry(
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
AS $$
DECLARE
  v_id UUID;
  v_created_at TIMESTAMPTZ;
BEGIN
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
$$;

REVOKE ALL ON FUNCTION create_calendar_entry(
  DATE, TEXT, TEXT, TEXT, UUID
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION create_calendar_entry(
  DATE, TEXT, TEXT, TEXT, UUID
) TO authenticated;

-- ─── RPC: update_calendar_entry ─────────────────────────────
-- Updates school_calendar; reconciles the holidays cache.
CREATE OR REPLACE FUNCTION update_calendar_entry(
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
AS $$
DECLARE
  v_old_date DATE;
  v_old_day_type TEXT;
  v_updated_at TIMESTAMPTZ;
BEGIN
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
$$;

REVOKE ALL ON FUNCTION update_calendar_entry(
  UUID, DATE, TEXT, TEXT, TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION update_calendar_entry(
  UUID, DATE, TEXT, TEXT, TEXT
) TO authenticated;

-- ─── RPC: delete_calendar_entry ─────────────────────────────
-- Deletes school_calendar and reconciles holidays cache.
CREATE OR REPLACE FUNCTION delete_calendar_entry(p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_old_date DATE;
  v_old_day_type TEXT;
BEGIN
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
$$;

REVOKE ALL ON FUNCTION delete_calendar_entry(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION delete_calendar_entry(UUID) TO authenticated;

-- ─── Backfill: any holidays rows that no longer have a matching
-- school_calendar entry are orphan (drift) and should be removed. ───
DELETE FROM holidays h
WHERE NOT EXISTS (
  SELECT 1 FROM school_calendar sc
  WHERE sc.calendar_date = h.holiday_date
    AND sc.day_type = h.type
);

-- ─── Backfill: any school_calendar rows of type holiday/event that
-- don't have a matching holidays row get one inserted. ───
INSERT INTO holidays (title, description, holiday_date, type)
SELECT sc.title, sc.description, sc.calendar_date, sc.day_type
FROM school_calendar sc
WHERE sc.day_type IN ('holiday', 'event')
ON CONFLICT (holiday_date, type) DO NOTHING;