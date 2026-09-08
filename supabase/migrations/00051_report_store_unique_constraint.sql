-- ============================================
-- JK Attendance - Migration 00051
-- report_store unique constraint for UPSERT
-- ============================================
-- Adds a unique constraint on (report_type, period_start) so the
-- cron-report edge function can use INSERT ... ON CONFLICT (upsert)
-- to re-run reports without duplicating rows.
-- ============================================

-- Deduplicate any existing rows that would violate the constraint.
-- Keep the most-recently-created row per (report_type, period_start).
DELETE FROM public.report_store a
USING public.report_store b
WHERE a.report_type = b.report_type
  AND a.period_start = b.period_start
  AND a.created_at < b.created_at;

-- Add the unique constraint (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'report_store_type_period_start_unique'
  ) THEN
    ALTER TABLE public.report_store
      ADD CONSTRAINT report_store_type_period_start_unique
      UNIQUE (report_type, period_start);
  END IF;
END
$$;

-- Drop the old single-column index that is now redundant (the unique
-- constraint creates an implicit index).
DROP INDEX IF EXISTS public.idx_report_store_type_period;
