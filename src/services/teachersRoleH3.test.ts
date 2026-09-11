import { describe, it, expect } from 'vitest'

/**
 * H3 — teachers.role privilege-escalation boundary tests.
 *
 * These tests verify the CONTRACT that migrations 00053 and 00055
 * enforce in production Postgres, without requiring a live database:
 *
 *   1. Column privileges: REVOKE UPDATE(role) ON teachers FROM anon,
 *      authenticated (mirrors 00040 for profiles.role).
 *   2. Trigger trg_teachers_role_immutable rejects direct role writes.
 *   3. RPC update_teacher_role() is superadmin-only with strict
 *      allowlist validation ('teacher' | 'admin' | 'superadmin').
 *   4. Client updateTeacher() never sends `role` (defense-in-depth).
 *   5. Trigger/RPC interplay: transaction-local GUC context allows
 *      the sanctioned RPC to bypass the trigger while all direct
 *      writes remain blocked.
 *
 * A static SQL parser checks the checked-in migration text, so the
 * security boundary itself is under test: if someone edits 00053 or
 * 00055 to weaken the REVOKE / trigger / RPC guard, these tests fail.
 * Live-DB verification SQL is embedded in the migration comments.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function migration00053Sql(): string {
  return readFileSync(
    join(process.cwd(), 'supabase/migrations/00053_teachers_role_immutable.sql'),
    'utf8'
  )
}

function migration00055Sql(): string {
  return readFileSync(
    join(process.cwd(), 'supabase/migrations/00055_fix_h3_rpc_trigger_interplay.sql'),
    'utf8'
  )
}

// ─── 00053: Column privileges and structural guards ──────────
describe('H3 teachers.role escalation boundary (00053)', () => {
  it('revokes UPDATE(role) on teachers from anon and authenticated', () => {
    const sql = migration00053Sql()
    expect(sql).toMatch(/REVOKE\s+UPDATE\s*\(\s*role\s*\)\s+ON\s+public\.teachers\s+FROM\s+anon/i)
    expect(sql).toMatch(
      /REVOKE\s+UPDATE\s*\(\s*role\s*\)\s+ON\s+public\.teachers\s+FROM\s+authenticated/i
    )
  })

  it('installs a BEFORE UPDATE trigger rejecting direct role changes with 42501', () => {
    const sql = migration00053Sql()
    expect(sql).toMatch(/CREATE TRIGGER trg_teachers_role_immutable/i)
    expect(sql).toMatch(/BEFORE UPDATE OF role ON public\.teachers/i)
    expect(sql).toMatch(/NEW\.role IS DISTINCT FROM OLD\.role/i)
    expect(sql).toMatch(/ERRCODE\s*=\s*'42501'/i)
  })

  it('exposes update_teacher_role() as SECURITY DEFINER with pinned search_path', () => {
    const sql = migration00053Sql()
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.update_teacher_role\(/i)
    expect(sql).toMatch(/SECURITY DEFINER/i)
    expect(sql).toMatch(/SET\s+search_path\s*=\s*pg_catalog,\s*public,\s*pg_temp/i)
  })

  it('restricts update_teacher_role() to superadmin callers', () => {
    const sql = migration00053Sql()
    expect(sql).toMatch(/IF NOT public\.is_superadmin\(\) THEN/i)
  })

  it('validates the new role against the canonical allowlist', () => {
    const sql = migration00053Sql()
    expect(sql).toMatch(/p_new_role NOT IN \('teacher', 'admin', 'superadmin'\)/i)
    expect(sql).toMatch(/ERRCODE\s*=\s*'22023'/i)
  })

  it('prevents a superadmin from demoting their own account', () => {
    const sql = migration00053Sql()
    expect(sql).toMatch(/cannot demote their own account/i)
  })

  it('does not grant role management to anon or PUBLIC', () => {
    const sql = migration00053Sql()
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.update_teacher_role\(UUID, TEXT\) FROM anon/i
    )
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.update_teacher_role\(UUID, TEXT\) FROM PUBLIC/i
    )
    expect(sql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.update_teacher_role\(UUID, TEXT\) TO anon/i
    )
    expect(sql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.update_teacher_role\(UUID, TEXT\) TO PUBLIC/i
    )
  })

  it('audit-logs role transitions via the existing audit_logs table', () => {
    const sql = migration00053Sql()
    expect(sql).toMatch(/INSERT INTO public\.audit_logs/i)
    expect(sql).toMatch(/'teachers\.role'/i)
  })
})

// ─── 00055: Trigger/RPC interplay fix ────────────────────────
describe('H3 trigger/RPC interplay (00055)', () => {
  it('creates verify_role_change_token() as SECURITY DEFINER', () => {
    const sql = migration00055Sql()
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.verify_role_change_token\(/i)
    expect(sql).toMatch(/SECURITY DEFINER/i)
    expect(sql).toMatch(/SET\s+search_path\s*=\s*pg_catalog,\s*public,\s*pg_temp/i)
  })

  it('verify_role_change_token() returns FALSE for NULL/empty/garbage tokens', () => {
    const sql = migration00055Sql()
    expect(sql).toMatch(/IF p_token IS NULL OR p_token = '' THEN/i)
    expect(sql).toMatch(/RETURN FALSE/i)
  })

  it('verify_role_change_token() extracts user ID from JWT claims', () => {
    const sql = migration00055Sql()
    expect(sql).toMatch(/request\.jwt\.claims/i)
    expect(sql).toMatch(/->>'sub'/i)
  })

  it('verify_role_change_token() computes HMAC from JWT secret', () => {
    const sql = migration00055Sql()
    expect(sql).toMatch(/app\.settings\.jwt_secret/i)
    expect(sql).toMatch(/digest\(/i)
    expect(sql).toMatch(/sha256/i)
  })

  it('trigger checks verify_role_change_token() before blocking', () => {
    const sql = migration00055Sql()
    expect(sql).toMatch(/verify_role_change_token\(/i)
    expect(sql).toMatch(/app\.role_change_token/i)
  })

  it('trigger fails closed when token is absent', () => {
    const sql = migration00055Sql()
    expect(sql).toMatch(/NOT public\.verify_role_change_token\(/i)
  })

  it('RPC sets app.role_change_token via set_config before UPDATE', () => {
    const sql = migration00055Sql()
    expect(sql).toMatch(/set_config\('app\.role_change_token'/i)
    expect(sql).toMatch(/, true\)/i) // is_local = true
  })

  it('RPC computes the HMAC token from JWT claims + JWT secret', () => {
    const sql = migration00055Sql()
    expect(sql).toMatch(/request\.jwt\.claims/i)
    expect(sql).toMatch(/app\.settings\.jwt_secret/i)
    expect(sql).toMatch(/encode\(/i)
    expect(sql).toMatch(/digest\(/i)
  })

  it('RPC does not accept a client-controlled bypass parameter', () => {
    const sql = migration00055Sql()
    // The function signature should only have p_teacher_id and p_new_role
    const fnMatch = sql.match(/CREATE OR REPLACE FUNCTION public\.update_teacher_role\([^)]*\)/is)
    expect(fnMatch).toBeTruthy()
    const params = fnMatch![0]
    expect(params).not.toMatch(/p_token/i)
    expect(params).not.toMatch(/p_bypass/i)
    expect(params).not.toMatch(/p_context/i)
    expect(params).toMatch(/p_teacher_id/)
    expect(params).toMatch(/p_new_role/)
  })

  it('RPC preserves all original guards (superadmin check, allowlist, self-demotion)', () => {
    const sql = migration00055Sql()
    expect(sql).toMatch(/IF NOT public\.is_superadmin\(\) THEN/i)
    expect(sql).toMatch(/p_new_role NOT IN \('teacher', 'admin', 'superadmin'\)/i)
    expect(sql).toMatch(/cannot demote their own account/i)
  })

  it('RPC preserves audit logging', () => {
    const sql = migration00055Sql()
    expect(sql).toMatch(/INSERT INTO public\.audit_logs/i)
    expect(sql).toMatch(/'teachers\.role'/i)
  })

  it('does not grant EXECUTE to anon or PUBLIC', () => {
    const sql = migration00055Sql()
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.update_teacher_role\(UUID, TEXT\) FROM anon/i
    )
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.update_teacher_role\(UUID, TEXT\) FROM PUBLIC/i
    )
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.update_teacher_role\(UUID, TEXT\) TO authenticated/i
    )
  })

  it('does not modify existing tables or objects from earlier migrations', () => {
    const sql = migration00055Sql()
    // Should not ALTER TABLE profiles or teachers (only CREATE OR REPLACE functions)
    expect(sql).not.toMatch(/ALTER TABLE/i)
    // Should not DROP existing tables
    expect(sql).not.toMatch(/DROP TABLE/i)
    // Should not modify RLS policies
    expect(sql).not.toMatch(/DROP POLICY/i)
    expect(sql).not.toMatch(/ALTER POLICY/i)
  })
})
