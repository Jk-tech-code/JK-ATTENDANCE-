-- ============================================
-- JK Attendance - Migration 00023
-- 1. Add updated_at column to school_settings
-- 2. Update school GPS coordinates to (-1.472988, 36.960895)
-- 3. Create trigger to auto-maintain updated_at
--
-- All SQL functions (check_in_with_location, etc.)
-- read from school_settings dynamically, so no
-- function changes are needed.
-- ============================================

-- ============================================
-- 1. ADD updated_at COLUMN
-- ============================================
ALTER TABLE public.school_settings
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

-- ============================================
-- 2. ADD TRIGGER FUNCTION to auto-set updated_at
-- ============================================
CREATE OR REPLACE FUNCTION set_school_settings_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_school_settings_updated_at ON public.school_settings;
CREATE TRIGGER trg_school_settings_updated_at
  BEFORE UPDATE ON public.school_settings
  FOR EACH ROW
  EXECUTE FUNCTION set_school_settings_updated_at();

-- ============================================
-- 3. UPDATE school_settings WITH NEW COORDINATES
-- ============================================
UPDATE public.school_settings
SET
  latitude = -1.472988,
  longitude = 36.960895;

-- ============================================
-- 4. VERIFY the update
-- Run this in Supabase SQL Editor:
--
--   SELECT id, school_name, latitude, longitude, allowed_radius_meters, updated_at
--   FROM public.school_settings;
-- ============================================
