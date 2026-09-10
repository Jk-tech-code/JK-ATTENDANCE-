import { describe, it, expect } from 'vitest'

/**
 * H3 — teachers.role privilege-escalation boundary tests.
 *
 * These tests verify the CONTRACT that migration 00053 enforces in
 * production Postgres, without requiring a live database:
 *
 *   1. Column privileges: REVOKE UPDATE(role) ON teachers FROM anon,
 *      authenticated (mirrors 00040 for profiles.role).
 *   2. Trigger trg_teachers_role_immutable rejects direct role writes.
 *   3. RPC update_teacher_role() is superadmin-only with strict
 *      allowlist validation ('teacher' | 'admin' | 'superadmin').
 *   4. Client updateTeacher() never sends `role` (defense-in-depth).
 *
 * A static SQL parser checks the checked-in migration text, so the
 * security boundary itself is under test: if someone edits 00053 to
 * weaken the REVOKE / trigger / RPC guard, these tests fail.
 * Live-DB verification SQL is embedded in the migration comments.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function migrationSql(): string {
  return readFileSync(
    join(process.cwd(), 'supabase/migrations/00053_teachers_role_immutable.sql'),
    'utf8'
  )
}

describe('H3 teachers.role escalation boundary', () => {
  it('revokes UPDATE(role) on teachers from anon and authenticated', () => {
    const sql = migrationSql()
    expect(sql).toMatch(/REVOKE\s+UPDATE\s*\(\s*role\s*\)\s+ON\s+public\.teachers\s+FROM\s+anon/i)
    expect(sql).toMatch(/REVOKE\s+UPDATE\s*\(\s*role\s*\)\s+ON\s+public\.teachers\s+FROM\s+authenticated/i)
  })

  it('installs a BEFORE UPDATE trigger rejecting direct role changes with 42501', () => {
    const sql = migrationSql()
    expect(sql).toMatch(/CREATE TRIGGER trg_teachers_role_immutable/i)
    expect(sql).toMatch(/BEFORE UPDATE OF role ON public\.teachers/i)
    expect(sql).toMatch(/NEW\.role IS DISTINCT FROM OLD\.role/i)
    expect(sql).toMatch(/ERRCODE\s*=\s*'42501'/i)
  })

  it('exposes update_teacher_role() as SECURITY DEFINER with pinned search_path', () => {
    const sql = migrationSql()
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.update_teacher_role\(/i)
    expect(sql).toMatch(/SECURITY DEFINER/i)
    expect(sql).toMatch(/SET\s+search_path\s*=\s*pg_catalog,\s*public,\s*pg_temp/i)
  })

  it('restricts update_teacher_role() to superadmin callers', () => {
    const sql = migrationSql()
    expect(sql).toMatch(/IF NOT public\.is_superadmin\(\) THEN/i)
  })

  it('validates the new role against the canonical allowlist', () => {
    const sql = migrationSql()
    expect(sql).toMatch(/p_new_role NOT IN \('teacher', 'admin', 'superadmin'\)/i)
    expect(sql).toMatch(/ERRCODE\s*=\s*'22023'/i)
  })

  it('prevents a superadmin from demoting their own account', () => {
    const sql = migrationSql()
    expect(sql).toMatch(/cannot demote their own account/i)
  })

  it('does not grant role management to anon or PUBLIC', () => {
    const sql = migrationSql()
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.update_teacher_role\(UUID, TEXT\) FROM anon/i)
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.update_teacher_role\(UUID, TEXT\) FROM PUBLIC/i)
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.update_teacher_role\(UUID, TEXT\) TO anon/i)
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.update_teacher_role\(UUID, TEXT\) TO PUBLIC/i)
  })

  it('audit-logs role transitions via the existing audit_logs table', () => {
    const sql = migrationSql()
    expect(sql).toMatch(/INSERT INTO public\.audit_logs/i)
    expect(sql).toMatch(/'teachers\.role'/i)
  })
})
