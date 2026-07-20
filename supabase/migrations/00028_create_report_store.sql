-- ============================================
-- JK Attendance - Migration 00028
-- Report Store + Cron Schedules
-- ============================================
-- Creates a report_store table to persist generated
-- daily and monthly reports for frontend queries.
-- Also sets up pg_cron schedules (requires pg_cron extension).
-- ============================================

-- ============================================
-- PART 1: Create report_store table
-- ============================================
CREATE TABLE IF NOT EXISTS public.report_store (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type TEXT NOT NULL CHECK (report_type IN ('daily', 'monthly')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookups by type and period
CREATE INDEX IF NOT EXISTS idx_report_store_type_period
  ON public.report_store (report_type, period_start DESC);

-- Index for fetching latest report of each type
CREATE INDEX IF NOT EXISTS idx_report_store_type_created
  ON public.report_store (report_type, created_at DESC);

-- ============================================
-- PART 2: Row-Level Security
-- ============================================
ALTER TABLE public.report_store ENABLE ROW LEVEL SECURITY;

-- Admins can read all stored reports
DROP POLICY IF EXISTS "Admins read report_store" ON public.report_store;
CREATE POLICY "Admins read report_store"
  ON public.report_store FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- Only the cron-report edge function (service_role) inserts;
-- RLS is bypassed for service_role, so no INSERT policy needed.
-- Block direct user inserts.
DROP POLICY IF EXISTS "No insert for regular users" ON public.report_store;
CREATE POLICY "No insert for regular users"
  ON public.report_store FOR INSERT
  TO authenticated
  WITH CHECK (false);

-- ============================================
-- PART 3: Cron Schedule (pg_cron)
-- ============================================
-- These schedules require the pg_cron extension to be enabled
-- (available on Supabase Pro plan and above).
-- On the Free Tier, use an external cron service (cron-job.org etc.)
-- pointing to the edge function URL.
--
-- Edge Function URLs (replace PROJECT_REF):
--   Daily:  https://PROJECT_REF.supabase.co/functions/v1/cron-report
--   Monthly: https://PROJECT_REF.supabase.co/functions/v1/cron-report
--
-- External cron-job.org config:
--   Daily:  Every day at 23:30  → POST with body {"type":"daily"}
--   Monthly: 1st of month 00:30 → POST with body {"type":"monthly"}
--
-- Add header: x-api-key = your CRON_SECRET
-- ============================================

-- ── Prerequisite: Set database-level config values ──────────
-- Before the pg_cron schedules will work, run these SQL commands
-- (replace PROJECT_REF with your actual Supabase project reference):
--
--   ALTER DATABASE postgres SET app.settings.cron_report_url TO
--     'https://PROJECT_REF.supabase.co/functions/v1/cron-report';
--
--   ALTER DATABASE postgres SET app.settings.cron_secret TO 'your-cron-secret';
--
-- Then reload the config:
--   SELECT pg_reload_conf();
--
-- ── Cron Schedule via pg_cron ────────────────────────────────
-- Only attempt pg_cron if the extension is available.
-- pg_cron requires the Supabase Pro plan (or higher).
DO $cron$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) THEN
    -- Daily report at 23:30 every day
    PERFORM cron.schedule(
      'report-daily',
      '30 23 * * *',
      $func$SELECT net.http_post(
        url := current_setting('app.settings.cron_report_url'),
        headers := ARRAY[
          'Content-Type', 'application/json',
          'x-api-key', current_setting('app.settings.cron_secret', true)
        ],
        body := '{"type":"daily"}'::text
      )$func$
    );

    -- Monthly report at 00:30 on the 1st of every month
    PERFORM cron.schedule(
      'report-monthly',
      '30 0 1 * *',
      $func$SELECT net.http_post(
        url := current_setting('app.settings.cron_report_url'),
        headers := ARRAY[
          'Content-Type', 'application/json',
          'x-api-key', current_setting('app.settings.cron_secret', true)
        ],
        body := '{"type":"monthly"}'::text
      )$func$
    );
  END IF;
END;
$cron$;

-- ============================================
-- PART 4: Verification Query
-- Run after migration:
--   SELECT report_type, period_start, period_end, created_at
--   FROM public.report_store
--   ORDER BY created_at DESC
--   LIMIT 10;
-- ============================================
