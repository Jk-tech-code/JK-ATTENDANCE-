-- ============================================
-- JK Attendance - Migration 00054
-- H2: Distributed rate limiting for Edge Functions
-- ============================================
-- Problem: _shared/rate-limit.ts uses a module-scoped in-memory Map.
-- Each Edge Function isolate has its own Map, cold starts reset counters,
-- concurrent isolates bypass limits, and horizontal scaling creates
-- independent counters. The authoritative limit must live in PostgreSQL.
--
-- Design (mirrors migration 00042's rate_limit_checkins pattern):
--   * Fixed-window counters in public.rate_limit_buckets
--   * ONE atomic RPC (consume_rate_limit) using INSERT ... ON CONFLICT
--     DO UPDATE ... WHERE <window is current> — single round trip, no
--     read-then-write race.
--   * SECURITY DEFINER + pinned search_path; EXECUTE granted to
--     service_role only. No client-facing surface: anon/authenticated
--     have no table privileges and no EXECUTE.
--   * Bucket model: one row per (key, window). Fixed windows are reused
--     per window_start, so the table is bounded; expired rows are purged
--     by cleanup_rate_limit_buckets (probabilistic in-request + manual).
-- ============================================

CREATE TABLE IF NOT EXISTS public.rate_limit_buckets (
  bucket_key TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bucket_key, window_start)
);

COMMENT ON TABLE public.rate_limit_buckets IS
  'H2 distributed rate limiting. One row per (key, fixed window). Written ONLY by consume_rate_limit() (SECURITY DEFINER). No client access.';

-- Enable RLS; no policies for anon/authenticated => no access. service_role
-- bypasses RLS by default in Supabase; the RPC is the only write path.
ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.rate_limit_buckets FROM anon, authenticated;

-- ============================================
-- Atomic consume RPC
-- ============================================
-- Consume one token for (p_namespace, p_identifier) in a p_window_seconds
-- fixed window with p_max_attempts allowed requests.
--
-- Concurrency safety: INSERT ... ON CONFLICT DO UPDATE on the primary key
-- (bucket_key, window_start). Because window_start is part of the key and is
-- derived from NOW() inside the database, a conflict can only ever be with
-- the CURRENT window's row. Postgres takes a row lock on the conflicting
-- tuple for the duration of the DO UPDATE, so concurrent consumers serialize
-- on the same bucket row and the count can never exceed p_max_attempts.
-- Old windows are separate rows (no conflict) and are purged by cleanup.
--
-- Returns:
--   allowed      - whether this request is permitted
--   remaining    - tokens left in the window after this consume
--   retry_after  - seconds until the window resets (0 when allowed)
--   reset_at     - absolute window reset timestamp
CREATE OR REPLACE FUNCTION public.consume_rate_limit(
  p_namespace TEXT,
  p_identifier TEXT,
  p_max_attempts INTEGER,
  p_window_seconds INTEGER
)
RETURNS TABLE (allowed BOOLEAN, remaining INTEGER, retry_after INTEGER, reset_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_key TEXT;
  v_window BIGINT;
  v_window_start TIMESTAMPTZ;
  v_next_window TIMESTAMPTZ;
  v_count INTEGER;
  v_retry_after INTEGER;
BEGIN
  -- Internal validation (defense-in-depth; callers must also validate).
  IF p_namespace IS NULL OR length(trim(p_namespace)) = 0
     OR p_namespace <> regexp_replace(p_namespace, '[^a-zA-Z0-9._-]', '', 'g') THEN
    RAISE EXCEPTION 'invalid rate limit namespace';
  END IF;
  IF p_identifier IS NULL OR length(trim(p_identifier)) = 0 THEN
    RAISE EXCEPTION 'invalid rate limit identifier';
  END IF;
  IF p_max_attempts IS NULL OR p_max_attempts < 1 OR p_max_attempts > 10000 THEN
    RAISE EXCEPTION 'invalid rate limit max attempts';
  END IF;
  IF p_window_seconds IS NULL OR p_window_seconds < 1 OR p_window_seconds > 86400 THEN
    RAISE EXCEPTION 'invalid rate limit window';
  END IF;

  v_key := left(p_namespace || ':' || p_identifier, 512);
  v_window := EXTRACT(EPOCH FROM NOW());
  v_window_start := to_timestamp(floor(v_window / p_window_seconds) * p_window_seconds);
  v_next_window := v_window_start + make_interval(secs => p_window_seconds);

  -- Single atomic operation: creates the window's bucket (count=1) or
  -- increments it under row lock. RETURNING yields this consumer's count.
  INSERT INTO public.rate_limit_buckets AS b (bucket_key, window_start, count)
  VALUES (v_key, v_window_start, 1)
  ON CONFLICT (bucket_key, window_start) DO UPDATE
    SET count = b.count + 1,
        updated_at = NOW()
  RETURNING count INTO v_count;

  IF v_count > p_max_attempts THEN
    -- Over limit: this request is rejected. Keep the counter above the
    -- limit (no rollback) so the window stays saturated while flooded.
    v_retry_after := GREATEST(
      1,
      CEILING(EXTRACT(EPOCH FROM (v_next_window - NOW())))::INTEGER
    );
    RETURN QUERY SELECT FALSE, 0, v_retry_after, v_next_window;
  ELSE
    RETURN QUERY SELECT TRUE, p_max_attempts - v_count, 0, v_next_window;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.consume_rate_limit IS
  'H2: atomic fixed-window rate limit consume. Returns allowed/remaining/retry_after/reset_at.';

-- service_role (Edge Functions) only. No PUBLIC execute, no client access.
REVOKE EXECUTE ON FUNCTION public.consume_rate_limit(TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(TEXT, TEXT, INTEGER, INTEGER) TO service_role;

-- ============================================
-- Cleanup / retention
-- ============================================
-- Deletes buckets whose window has ended (grace margin for observability).
-- Called probabilistically by consume_rate_limit callers and can be wired
-- to a cron. Cheap: PK-leading index on window_start.
CREATE OR REPLACE FUNCTION public.cleanup_rate_limit_buckets()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM public.rate_limit_buckets
  WHERE window_start < NOW() - INTERVAL '10 minutes';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.cleanup_rate_limit_buckets IS
  'H2: purges expired rate limit buckets. Bounded table growth.';

REVOKE EXECUTE ON FUNCTION public.cleanup_rate_limit_buckets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_rate_limit_buckets() TO service_role;

-- Index to make periodic cleanup cheap.
CREATE INDEX IF NOT EXISTS idx_rate_limit_buckets_window_start
  ON public.rate_limit_buckets (window_start);

-- ============================================
-- Verification queries (run manually after applying)
-- ============================================
-- 1. Table + RLS:
--    SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'rate_limit_buckets';
--    SELECT * FROM pg_tables WHERE tablename = 'rate_limit_buckets';
--
-- 2. Function privileges:
--    SELECT proacl FROM pg_proc WHERE proname = 'consume_rate_limit';
--
-- 3. Atomic behavior (concurrency):
--    -- 10 parallel: SELECT consume_rate_limit('t','k',5,60);
--    -- => exactly 5 allowed, 5 rejected with retry_after > 0.
--
-- 4. Cleanup:
--    SELECT public.cleanup_rate_limit_buckets();
