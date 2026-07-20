-- ============================================
-- JK Attendance - Migration 00025
-- Add updated_at column and auto-update trigger
-- to secondary tables: school_calendar,
-- school_holidays, attendance_notifications
--
-- Uses the generic set_updated_at() function
-- created in migration 00024.
--
-- Note: audit_logs is append-only and is NOT
-- included (INSERT-only, never updated).
-- ============================================

-- ============================================
-- 1. SCHOOL CALENDAR
-- ============================================

ALTER TABLE public.school_calendar
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

-- Backfill existing rows
UPDATE public.school_calendar
SET updated_at = created_at
WHERE updated_at IS NULL;

DROP TRIGGER IF EXISTS trg_school_calendar_updated_at ON public.school_calendar;
CREATE TRIGGER trg_school_calendar_updated_at
  BEFORE UPDATE ON public.school_calendar
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ============================================
-- 2. SCHOOL HOLIDAYS
-- ============================================

ALTER TABLE public.school_holidays
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

-- Backfill existing rows
UPDATE public.school_holidays
SET updated_at = created_at
WHERE updated_at IS NULL;

DROP TRIGGER IF EXISTS trg_school_holidays_updated_at ON public.school_holidays;
CREATE TRIGGER trg_school_holidays_updated_at
  BEFORE UPDATE ON public.school_holidays
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ============================================
-- 3. ATTENDANCE NOTIFICATIONS
-- ============================================

ALTER TABLE public.attendance_notifications
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

-- Backfill: use the most recent meaningful timestamp
UPDATE public.attendance_notifications
SET updated_at = COALESCE(read_at, sent_at, created_at)
WHERE updated_at IS NULL;

DROP TRIGGER IF EXISTS trg_attendance_notifications_updated_at ON public.attendance_notifications;
CREATE TRIGGER trg_attendance_notifications_updated_at
  BEFORE UPDATE ON public.attendance_notifications
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ============================================
-- 4. VERIFICATION
-- Run this in Supabase SQL Editor:
--
--   SELECT 'school_calendar' AS tbl, COUNT(*) AS total, COUNT(updated_at) AS with_updated_at
--   FROM public.school_calendar
--   UNION ALL
--   SELECT 'school_holidays', COUNT(*), COUNT(updated_at)
--   FROM public.school_holidays
--   UNION ALL
--   SELECT 'attendance_notifications', COUNT(*), COUNT(updated_at)
--   FROM public.attendance_notifications;
-- ============================================
