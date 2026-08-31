-- ============================================
-- 00038_attendance_rpc_ownership.sql
-- ============================================
-- WHY:
--   The three attendance-mutation RPCs are SECURITY DEFINER and took a
--   caller-supplied id with NO ownership check, while granting EXECUTE to
--   anon + authenticated (verified on live prod 2026-08-27). That means:
--
--     * check_out(p_attendance_id) / undo_check_out(p_attendance_id):
--         ANY caller (even anon, via PostgREST + the public anon key)
--         could check out or undo-checkout ANY teacher's attendance row
--         just by supplying/guessing its UUID.
--     * check_in_with_location(p_teacher_id, ...):
--         ANY caller could create/overwrite a check-in for ANY teacher by
--         passing that teacher's id (attendance fraud / tampering).
--
--   FIX (defense in depth, two layers):
--     1. REVOKE EXECUTE FROM anon on all three. Checking in/out is only
--        ever done by a logged-in teacher; there is no pre-login flow.
--        (authenticated is retained — the frontend calls these with the
--        teacher's session; see src/services/attendance.ts.)
--     2. Add an internal ownership guard to each body:
--          check_in_with_location -> caller must own p_teacher_id
--          check_out / undo_check_out -> caller must own the row's
--                                        teacher_id
--        `... OR public.is_admin()` is allowed so an admin is never
--        locked out of a corrective action. Non-owners (incl. anon, whose
--        auth.uid() is NULL) get SQLSTATE 42501 -> HTTP 403.
--
--   is_teacher_owner()/is_admin() read auth.uid() (the request JWT claim),
--   which is preserved inside SECURITY DEFINER, so the guard evaluates the
--   CALLER, not the function owner. No edge function / service_role path
--   calls these RPCs (verified: only src/services/attendance.ts does), so
--   nothing server-side breaks.
--
--   ALSO: pin search_path = pg_catalog, public, pg_temp (was unset ->
--   pg_temp searched first -> temp-table shadow vector). The one public
--   helper call, format_working_hours(), is schema-qualified to
--   public.format_working_hours() so it no longer depends on the path at
--   all. Bodies are otherwise reproduced verbatim from live definitions.
-- ============================================

REVOKE EXECUTE ON FUNCTION public.check_in_with_location(uuid, double precision, double precision, text, text, double precision) FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_out(uuid)      FROM anon;
REVOKE EXECUTE ON FUNCTION public.undo_check_out(uuid) FROM anon;

-- --------------------------------------------
-- check_in_with_location(...)
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.check_in_with_location(p_teacher_id uuid, p_latitude double precision, p_longitude double precision, p_device text, p_browser text, p_accuracy double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_settings RECORD;
  v_distance DOUBLE PRECISION;
  v_today DATE := CURRENT_DATE;
  v_now TIMESTAMPTZ := NOW();
  v_status TEXT := 'present';
  v_attendance_status TEXT;
  v_location_status TEXT := 'inside_school';
  v_reporting_time TIME;
  v_grace_end TIME;
  v_late_minutes INTEGER := 0;
  v_existing_record RECORD;
  v_row RECORD;
BEGIN
  IF NOT (public.is_teacher_owner(p_teacher_id) OR public.is_admin()) THEN
    RAISE EXCEPTION 'Access denied: you can only check in as yourself' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_settings
  FROM school_settings
  WHERE active = TRUE
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No active school settings configured. Contact administrator.'
    );
  END IF;

  IF p_accuracy IS NOT NULL AND p_accuracy > 50 THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'rejected',
      'location_status', 'low_accuracy',
      'accuracy', ROUND(p_accuracy::numeric, 0),
      'message', 'GPS signal too weak. Accuracy must be within 50 meters.'
    );
  END IF;

  v_distance := 6371000 * 2 * ASIN(
    SQRT(
      SIN(RADIANS(v_settings.latitude - p_latitude) / 2)^2 +
      COS(RADIANS(v_settings.latitude)) * COS(RADIANS(p_latitude)) *
      SIN(RADIANS(v_settings.longitude - p_longitude) / 2)^2
    )
  );

  IF v_distance > v_settings.allowed_radius_meters THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'rejected',
      'location_status', 'outside_school',
      'distance', ROUND(v_distance::numeric, 0),
      'message', 'You are outside the approved school attendance zone.'
    );
  END IF;

  SELECT * INTO v_existing_record
  FROM attendance
  WHERE teacher_id = p_teacher_id AND attendance_date = v_today;

  IF FOUND THEN
    IF v_existing_record.check_in IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'already_checked_in'
      );
    END IF;
  END IF;

  -- Legacy status (backward compatible)
  SELECT COALESCE(reporting_time, '07:20'::TIME) INTO v_reporting_time
  FROM teachers
  WHERE id = p_teacher_id;

  IF v_now::TIME > v_reporting_time THEN
    v_late_minutes := EXTRACT(EPOCH FROM (v_now::TIME - v_reporting_time)) / 60;
    v_status := 'late';
  END IF;

  -- New attendance status based on school settings
  v_grace_end := v_settings.reporting_start_time + (v_settings.grace_period_minutes || ' minutes')::INTERVAL;
  v_attendance_status := CASE WHEN v_now::TIME > v_grace_end THEN 'LATE' ELSE 'PRESENT' END;

  INSERT INTO attendance (
    teacher_id, attendance_date, check_in, check_in_time, status, attendance_status, late_minutes,
    latitude, longitude,
    teacher_latitude, teacher_longitude,
    school_latitude, school_longitude,
    distance_from_school, location_status,
    device, browser, gps_accuracy
  )
  VALUES (
    p_teacher_id, v_today, v_now, v_now::TIME, v_status, v_attendance_status, v_late_minutes,
    p_latitude, p_longitude,
    p_latitude, p_longitude,
    v_settings.latitude, v_settings.longitude,
    ROUND(v_distance::numeric, 0), v_location_status,
    p_device, p_browser, p_accuracy
  )
  ON CONFLICT (teacher_id, attendance_date)
  DO UPDATE SET
    check_in = v_now,
    check_in_time = v_now::TIME,
    status = v_status,
    attendance_status = v_attendance_status,
    late_minutes = v_late_minutes,
    latitude = p_latitude,
    longitude = p_longitude,
    teacher_latitude = p_latitude,
    teacher_longitude = p_longitude,
    school_latitude = v_settings.latitude,
    school_longitude = v_settings.longitude,
    distance_from_school = ROUND(v_distance::numeric, 0),
    location_status = v_location_status,
    device = p_device,
    browser = p_browser,
    gps_accuracy = p_accuracy
  WHERE attendance.check_in IS NULL
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'already_checked_in'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'status', v_status,
    'attendance_status', v_attendance_status,
    'location_status', v_location_status,
    'distance', ROUND(v_distance::numeric, 0),
    'id', v_row.id
  );
END;
$function$;

-- --------------------------------------------
-- check_out(p_attendance_id uuid)
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.check_out(p_attendance_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_row RECORD;
  v_now TIMESTAMPTZ := NOW();
  v_settings RECORD;
  v_attendance_status TEXT;
  v_early_departure_minutes INTEGER := 0;
  v_checkout_time TIME;
BEGIN
  SELECT * INTO v_row FROM attendance WHERE id = p_attendance_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  IF NOT (public.is_teacher_owner(v_row.teacher_id) OR public.is_admin()) THEN
    RAISE EXCEPTION 'Access denied: not your attendance record' USING ERRCODE = '42501';
  END IF;

  IF v_row.check_in IS NULL THEN
    RETURN jsonb_build_object('error', 'not_checked_in');
  END IF;

  IF v_row.check_out IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'already_checked_out');
  END IF;

  -- Get school settings for checkout time
  SELECT * INTO v_settings
  FROM school_settings
  WHERE active = TRUE
  LIMIT 1;

  v_checkout_time := COALESCE(v_settings.checkout_time, '17:30'::TIME);
  v_early_departure_minutes := 0;

  -- Calculate early departure
  IF v_now::TIME < v_checkout_time THEN
    v_early_departure_minutes := EXTRACT(EPOCH FROM (v_checkout_time - v_now::TIME)) / 60;
    v_attendance_status := 'EARLY_DEPARTURE';
  ELSE
    v_attendance_status := 'COMPLETE_DAY';
  END IF;

  UPDATE attendance
  SET
    check_out = v_now,
    check_out_time = v_now::TIME,
    working_minutes = GREATEST(0, EXTRACT(EPOCH FROM (v_now - v_row.check_in)) / 60),
    working_hours = public.format_working_hours(v_row.check_in, v_now),
    status = 'checked_out',
    attendance_status = v_attendance_status,
    early_departure_minutes = v_early_departure_minutes,
    check_out_expires_at = v_now + INTERVAL '5 minutes'
  WHERE id = p_attendance_id
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$function$;

-- --------------------------------------------
-- undo_check_out(p_attendance_id uuid)
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.undo_check_out(p_attendance_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_row RECORD;
  v_now TIMESTAMPTZ := NOW();
  v_settings RECORD;
  v_grace_end TIME;
BEGIN
  SELECT * INTO v_row FROM attendance WHERE id = p_attendance_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  IF NOT (public.is_teacher_owner(v_row.teacher_id) OR public.is_admin()) THEN
    RAISE EXCEPTION 'Access denied: not your attendance record' USING ERRCODE = '42501';
  END IF;

  IF v_row.check_out IS NULL THEN
    RETURN jsonb_build_object('error', 'not_checked_out');
  END IF;

  IF v_now > v_row.check_out_expires_at THEN
    RETURN jsonb_build_object('error', 'undo_window_expired');
  END IF;

  -- Get school settings to recompute attendance_status
  SELECT * INTO v_settings
  FROM school_settings
  WHERE active = TRUE
  LIMIT 1;

  v_grace_end := v_settings.reporting_start_time + (v_settings.grace_period_minutes || ' minutes')::INTERVAL;

  UPDATE attendance
  SET
    check_out = NULL,
    check_out_time = NULL,
    working_minutes = NULL,
    working_hours = NULL,
    status = CASE WHEN COALESCE(v_row.late_minutes, 0) > 0 THEN 'late' ELSE 'present' END,
    attendance_status = CASE WHEN v_row.check_in_time IS NOT NULL AND v_row.check_in_time > v_grace_end THEN 'LATE' ELSE 'PRESENT' END,
    early_departure_minutes = NULL,
    check_out_expires_at = NULL
  WHERE id = p_attendance_id
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$function$;
