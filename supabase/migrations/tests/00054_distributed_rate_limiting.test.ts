/**
 * H2 tests — migration 00054 contract (static SQL verification).
 *
 * The migration cannot be applied inside Node vitest, so these tests verify
 * the SECURITY CONTRACT of the migration by reading the migration file —
 * the same statically-verified approach the project already uses for H3
 * (`teachersRoleH3.test.ts`). Live verification is reported separately in
 * the Phase 3 report (it requires a Supabase environment).
 *
 * Covered (Steps 5, 6, 13, 14, 15):
 *   TEST F  atomic single-statement mechanism (no read-then-write race)
 *   TEST G  privileges/grants and identity-key design
 *   TEST L  bounded growth: bucket model + cleanup function
 *   atomicity guards, SECURITY DEFINER hardening, index for cleanup
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const migrationPath = path.join(
  process.cwd(),
  'supabase',
  'migrations',
  '00054_distributed_rate_limiting.sql'
)
const sql = readFileSync(migrationPath, 'utf8')

describe('H2 migration 00054 — distributed rate limiting contract', () => {
  it('creates the rate_limit_buckets table with a composite (key, window_start) primary key', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.rate_limit_buckets/)
    expect(sql).toMatch(/PRIMARY KEY \(bucket_key, window_start\)/)
  })

  it('enables RLS and revokes all table privileges from anon and authenticated', () => {
    expect(sql).toMatch(/ALTER TABLE public\.rate_limit_buckets ENABLE ROW LEVEL SECURITY/)
    expect(sql).toMatch(
      /REVOKE ALL ON public\.rate_limit_buckets FROM anon, authenticated/
    )
  })

  it('implements consumption as ONE atomic statement (INSERT ... ON CONFLICT DO UPDATE), not read-then-write', () => {
    // The only path that mutates the counter must be a single upsert.
    expect(sql).toMatch(/INSERT INTO public\.rate_limit_buckets AS b/)
    expect(sql).toMatch(/ON CONFLICT \(bucket_key, window_start\) DO UPDATE/)
    expect(sql).toMatch(/SET count = b\.count \+ 1/)
    // No separate read-then-write pattern.
    expect(sql).not.toMatch(/SELECT[\s\S]*FROM public\.rate_limit_buckets[\s\S]*UPDATE public\.rate_limit_buckets/)
    // The count increment is atomic — not computed from a prior SELECT.
    expect(sql).not.toMatch(/count = v_count \+ 1/)
  })

  it('derives window_start from database time inside the function (client time never trusted)', () => {
    expect(sql).toMatch(/EXTRACT\(EPOCH FROM NOW\(\)\)/)
    expect(sql).toMatch(/to_timestamp\(floor\(v_window \/ p_window_seconds\) \* p_window_seconds\)/)
  })

  it('returns allowed, remaining, retry_after and reset_at', () => {
    expect(sql).toMatch(
      /RETURNS TABLE \(allowed BOOLEAN, remaining INTEGER, retry_after INTEGER, reset_at TIMESTAMPTZ\)/
    )
    expect(sql).toMatch(/RETURN QUERY SELECT FALSE, 0, v_retry_after, v_next_window/)
    expect(sql).toMatch(/RETURN QUERY SELECT TRUE, p_max_attempts - v_count, 0, v_next_window/)
  })

  it('validates its inputs inside the function (namespace charset, bounds)', () => {
    expect(sql).toMatch(/RAISE EXCEPTION 'invalid rate limit namespace'/)
    expect(sql).toMatch(/RAISE EXCEPTION 'invalid rate limit identifier'/)
    expect(sql).toMatch(/RAISE EXCEPTION 'invalid rate limit max attempts'/)
    expect(sql).toMatch(/RAISE EXCEPTION 'invalid rate limit window'/)
    expect(sql).toMatch(/p_max_attempts > 10000/)
    expect(sql).toMatch(/p_window_seconds > 86400/)
  })

  it('is SECURITY DEFINER with a pinned search_path', () => {
    expect(sql).toMatch(/SECURITY DEFINER/)
    expect(sql).toMatch(/SET search_path = pg_catalog, public, pg_temp/)
  })

  it('grants EXECUTE on consume_rate_limit to service_role ONLY (no PUBLIC/anon/authenticated)', () => {
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.consume_rate_limit\(TEXT, TEXT, INTEGER, INTEGER\) FROM PUBLIC, anon, authenticated/
    )
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.consume_rate_limit\(TEXT, TEXT, INTEGER, INTEGER\) TO service_role/
    )
  })

  it('provides a bounded-growth cleanup function restricted to service_role', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.cleanup_rate_limit_buckets\(\)/)
    expect(sql).toMatch(/WHERE window_start < NOW\(\) - INTERVAL '10 minutes'/)
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.cleanup_rate_limit_buckets\(\) FROM PUBLIC, anon, authenticated/
    )
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.cleanup_rate_limit_buckets\(\) TO service_role/
    )
  })

  it('indexes window_start so cleanup stays cheap (no full scans)', () => {
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_rate_limit_buckets_window_start\s+ON public\.rate_limit_buckets \(window_start\)/
    )
  })

  it('caps the stored key length to bound row size', () => {
    expect(sql).toMatch(/left\(p_namespace \|\| ':' \|\| p_identifier, 512\)/)
  })

  it('does not create a policy that would expose rows to client roles (no CREATE POLICY at all)', () => {
    // With RLS enabled and zero policies, anon/authenticated get no rows.
    // The RPC (SECURITY DEFINER) is the only write path.
    expect(sql).not.toMatch(/CREATE POLICY/)
  })
})
