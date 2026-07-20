-- ============================================
-- JK Attendance - Migration 00022
-- Fix: Remove overloaded check_in_with_location
-- 
-- PROBLEM:
-- Migration 00009 created the function with DOUBLE PRECISION params.
-- Migration 00014 recreated it (same signature: DOUBLE PRECISION).
-- Migration 00016 attempted to alter the signature to DECIMAL/NUMERIC
-- but CREATE OR REPLACE cannot change parameter types, so it silently
-- created a SECOND overloaded version (UUID, NUMERIC, NUMERIC, TEXT, TEXT, NUMERIC).
-- 
-- When the frontend calls check_in_with_location with JavaScript number
-- values, PostgREST cannot decide between:
--   check_in_with_location(UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, DOUBLE PRECISION)
--   check_in_with_location(UUID, NUMERIC, NUMERIC, TEXT, TEXT, NUMERIC)
-- 
-- FIX:
-- 1. Drop BOTH overloads explicitly
-- 2. Recreate with DOUBLE PRECISION (correct type for GPS coordinates)
-- 3. Use the latest implementation from migration 00014 (most complete)
-- ============================================

-- ============================================
-- 1. DROP BOTH OVERLOADS
-- ============================================

DROP FUNCTION IF EXISTS check_in_with_location(UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, DOUBLE PRECISION);
DROP FUNCTION IF EXISTS check_in_with_location(UUID, NUMERIC, NUMERIC, TEXT, TEXT, NUMERIC);

-- ============================================
-- 2. RECREATE THE DEFINITIVE VERSION
-- Uses DOUBLE PRECISION for GPS coordinates (correct type)
-- Implementation from migration 00014 (most complete)
-- ============================================

CREATE OR REPLACE FUNCTION check_in_with_location(
  p_teacher_id UUID,
  p_latitude DOUBLE PRECISION,
  p_longitude DOUBLE PRECISION,
  p_device TEXT,
  p_browser TEXT,
  p_accuracy DOUBLE PRECISION
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
$$;

-- ============================================
-- 3. VERIFY NO REMAINING OVERLOADS
-- The query below should return exactly 1 row.
-- Run this in Supabase SQL Editor to confirm:
--
--   SELECT proname, pg_get_function_identity_arguments(oid)
--   FROM pg_proc
--   WHERE proname = 'check_in_with_location';
-- ============================================
