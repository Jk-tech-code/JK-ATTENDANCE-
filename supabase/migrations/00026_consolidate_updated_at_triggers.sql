-- ============================================
-- JK Attendance - Migration 00026
-- Consolidate: switch school_settings trigger to
-- the generic set_updated_at() function and drop
-- the now-unused dedicated function.
--
-- Migration 00023 created a dedicated function
-- set_school_settings_updated_at() for the
-- school_settings trigger.
-- Migration 00024 created a generic reusable
-- set_updated_at() function used by all other
-- tables.
--
-- This migration migrates school_settings to the
-- generic function, eliminating the duplication.
-- ============================================

-- ============================================
-- 1. SWITCH TRIGGER TO GENERIC FUNCTION
-- ============================================

DROP TRIGGER IF EXISTS trg_school_settings_updated_at ON public.school_settings;
CREATE TRIGGER trg_school_settings_updated_at
  BEFORE UPDATE ON public.school_settings
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ============================================
-- 2. DROP THE NOW-UNUSED DEDICATED FUNCTION
-- ============================================

DROP FUNCTION IF EXISTS set_school_settings_updated_at();

-- ============================================
-- 3. VERIFICATION
-- Run this in Supabase SQL Editor:
--
--   -- Confirm trigger uses generic function
--   SELECT tgname, tgfname
--   FROM pg_trigger
--   WHERE tgrelid = 'public.school_settings'::regclass
--     AND tgname = 'trg_school_settings_updated_at';
--   -- Expected: tgfname = 'set_updated_at'
--
--   -- Confirm old function is gone
--   SELECT proname
--   FROM pg_proc
--   WHERE proname = 'set_school_settings_updated_at';
--   -- Expected: empty result
-- ============================================
