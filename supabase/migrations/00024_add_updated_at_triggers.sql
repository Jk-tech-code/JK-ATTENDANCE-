-- ============================================
-- JK Attendance - Migration 00024
-- Add updated_at column and auto-update trigger
-- to teachers and attendance tables
--
-- Uses a reusable trigger function so the same
-- logic works for any table that needs it.
-- ============================================

-- ============================================
-- 1. REUSABLE TRIGGER FUNCTION
-- ============================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ============================================
-- 2. TEACHERS TABLE
-- ============================================

ALTER TABLE public.teachers
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

-- Backfill existing rows
UPDATE public.teachers
SET updated_at = created_at
WHERE updated_at IS NULL;

DROP TRIGGER IF EXISTS trg_teachers_updated_at ON public.teachers;
CREATE TRIGGER trg_teachers_updated_at
  BEFORE UPDATE ON public.teachers
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ============================================
-- 3. ATTENDANCE TABLE
-- ============================================

ALTER TABLE public.attendance
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

-- Backfill existing rows
UPDATE public.attendance
SET updated_at = COALESCE(check_out, check_in, created_at)
WHERE updated_at IS NULL;

DROP TRIGGER IF EXISTS trg_attendance_updated_at ON public.attendance;
CREATE TRIGGER trg_attendance_updated_at
  BEFORE UPDATE ON public.attendance
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ============================================
-- 4. VERIFICATION
-- Run this in Supabase SQL Editor:
--
--   SELECT 'teachers' AS tbl, COUNT(*) AS total, COUNT(updated_at) AS with_updated_at
--   FROM public.teachers
--   UNION ALL
--   SELECT 'attendance', COUNT(*), COUNT(updated_at)
--   FROM public.attendance;
-- ============================================
