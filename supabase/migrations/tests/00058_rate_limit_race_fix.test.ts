/**
 * Tests — migration 00058 contract (static SQL verification).
 *
 * Verifies that the rate-limiting logic in `check_in_with_location` is
 * race-free: it inserts the attempt first (atomically), then checks the
 * count, and rolls back its own insert if rejected. This mirrors the
 * static-verification approach used for migration 00054.
 *
 * Covered contract:
 *   FIX  the rate-limit mechanism is INSERT-first, not read-then-write
 *   FIX  rejected attempts are rolled back so the table stays accurate
 *   FIX  the ownership/authorization guard is preserved
 *   FIX  timezone handling uses Africa/Nairobi
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const migrationPath = path.join(
  process.cwd(),
  'supabase',
  'migrations',
  '00058_fix_rate_limit_race_condition.sql'
)
const sql = readFileSync(migrationPath, 'utf8')

describe('migration 00058 — race-free rate limiting in check_in_with_location', () => {
  it('preserves the function signature and SECURITY DEFINER search_path', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.check_in_with_location/)
    expect(sql).toMatch(/SECURITY DEFINER/)
    expect(sql).toMatch(/SET search_path = pg_catalog, public, pg_temp/)
  })

  it('uses INSERT-first for rate limiting (no pre-check READ)', () => {
    // The attempt is recorded via INSERT before the COUNT decision is made.
    // This is the core fix: the INSERT acquires a row lock implicitly,
    // so two concurrent transactions serialize on the write.
    expect(sql).toMatch(/INSERT INTO public\.rate_limit_checkins \(teacher_id, attempt_time\)/)
    // The count must happen AFTER the insert, checking for > 5 (not >= 5)
    expect(sql).toMatch(/v_attempt_count > 5/)
  })

  it('rolls back the rejected attempt so the table stays accurate', () => {
    // On rejection, the function must discard its own insert to prevent
    // inflating the counter for a blocked caller.
    expect(sql).toMatch(/ROLLBACK TO SAVEPOINT rate_limit_point/)
    expect(sql).toMatch(/SAVEPOINT rate_limit_point/)
  })

  it('preserves the ownership/authorization guard', () => {
    expect(sql).toMatch(/public\.is_teacher_owner\(p_teacher_id\)/)
    expect(sql).toMatch(/OR public\.is_admin\(\)/)
    expect(sql).toMatch(/'Access denied: you can only check in as yourself'/)
  })

  it('uses Africa/Nairobi for the attendance date (timezone correctness)', () => {
    expect(sql).toMatch(/CURRENT_TIMESTAMP AT TIME ZONE 'Africa\/Nairobi'\)::date/)
  })

  it('returns the rate limit metadata in the successful result', () => {
    // The response should include the rate_limit object for client-side UX.
    expect(sql).toMatch(/'attempts_used'/)
    expect(sql).toMatch(/'max_attempts'/)
    expect(sql).toMatch(/'remaining'/)
  })

  it('returns the rate limit metadata in the rejected result', () => {
    expect(sql).toMatch(/'retry_after_seconds'/)
    expect(sql).toMatch(/'attempts_in_window'/)
  })

  it('grants EXECUTE to authenticated (the real caller of this RPC)', () => {
    expect(sql).toMatch(/GRANT\s+EXECUTE ON FUNCTION public\.check_in_with_location.*TO authenticated/)
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.check_in_with_location.*FROM PUBLIC/)
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.check_in_with_location.*FROM anon/)
  })

  it('replaces the legacy read-then-write pattern with the atomic INSERT-first pattern', () => {
    // The old pattern (v_attempt_count >= 5 BEFORE inserting) must NOT exist.
    expect(sql).not.toMatch(/SELECT COUNT\(\*\) INTO v_attempt_count[\s\S]*?INSERT INTO public\.rate_limit_checkins/)
  })
})
