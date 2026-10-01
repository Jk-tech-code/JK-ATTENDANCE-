/**
 * Tests — migration 00059 contract (static SQL verification).
 *
 * Verifies that `update_teacher_role` and `verify_role_change_token` read the
 * `app.settings.jwt_secret` GUC and FAIL CLOSED when it is unset — i.e. there
 * is no hardcoded fallback secret in the migration text.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const migrationPath = path.join(
  process.cwd(),
  'supabase',
  'migrations',
  '00059_fix_jwt_secret_guc.sql'
)
const sql = readFileSync(migrationPath, 'utf8')

describe('migration 00059 — jwt_secret fail-closed configuration', () => {
  it('updates verify_role_change_token and update_teacher_role to read the GUC', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.verify_role_change_token/)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.update_teacher_role/)
    expect(sql).toMatch(/app\.settings\.jwt_secret/)
  })

  it('fails closed: no hardcoded fallback secret in the migration text', () => {
    // The old hardcoded secret must not appear anywhere in the migration.
    expect(sql).not.toMatch(/304081e21600b6166734d1d2d06a672f460a6ddb94ed1301d847ae5c2ff2daf6/)
    // No COALESCE(..., '<secret>') fallback pattern.
    expect(sql).not.toMatch(/COALESCE\([\s\S]*'\s*[0-9a-f]{32,}\s*'\s*\)/i)
  })

  it('verify_role_change_token returns FALSE when the secret is unset', () => {
    expect(sql).toMatch(/app\.settings\.jwt_secret not configured/i)
    expect(sql).toMatch(/RETURN FALSE/)
  })

  it('update_teacher_role raises when the secret is unset', () => {
    expect(sql).toMatch(/app\.settings\.jwt_secret not configured/i)
    expect(sql).toMatch(/ERRCODE\s*=\s*'42501'/i)
  })

  it('maintains SECURITY DEFINER and pinned search_path', () => {
    expect(sql).toMatch(/SECURITY DEFINER/)
    expect(sql).toMatch(/SET search_path = pg_catalog, public, pg_temp/)
  })

  it('does not expose the secret in any client-facing code path', () => {
    // The secret must never appear in a GRANT, a policy, or a comment
    // that could be read by authenticated/anon users.
    expect(sql).not.toMatch(/GRANT.*jwt_secret/)
    expect(sql).not.toMatch(/CREATE POLICY.*jwt_secret/)
  })
})