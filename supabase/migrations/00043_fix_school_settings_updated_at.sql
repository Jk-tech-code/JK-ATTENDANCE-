-- ============================================
-- JK Attendance - Migration 00043
-- Fix: add missing updated_at column to
-- school_settings table.
--
-- Migration 00023 was intended to add this
-- column and create the trigger, but the
-- column was missing on the remote database.
-- The trigger trg_school_settings_updated_at
-- was created in 00023/00026 and calls
-- set_updated_at() which references
-- NEW.updated_at, causing:
--   "record 'new' has no field 'updated_at'"
-- on every school_settings update.
-- ============================================

ALTER TABLE public.school_settings
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Backfill any existing rows
UPDATE public.school_settings
SET updated_at = COALESCE(created_at, NOW())
WHERE updated_at IS NULL;

-- Ensure the trigger exists (idempotent)
DROP TRIGGER IF EXISTS trg_school_settings_updated_at ON public.school_settings;
CREATE TRIGGER trg_school_settings_updated_at
  BEFORE UPDATE ON public.school_settings
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
