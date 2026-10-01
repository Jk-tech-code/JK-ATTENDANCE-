/**
 * Tests — migration 00059 contract (static SQL verification).
 *
 * Verifies that the `app.settings.jwt_secret` GUC is configured at the
 * database level so the role-change RPC (`update_teacher_role`) and its
 * trigger (`trg_teachers_role_immutable`) can compute the HMAC token.
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

describe('migration 00059 — jwt_secret GUC configuration', () => {
  it('sets the app.settings.jwt_secret GUC at the database level', () => {
    expect(sql).toMatch(/ALTER DATABASE postgres SET app\.settings\.jwt_secret TO/)
  })

  it('uses a non-empty secret value (not NULL or empty string)', () => {
    expect(sql).not.toMatch(/ALTER DATABASE postgres SET app\.settings\.jwt_secret TO ''/)
    expect(sql).not.toMatch(/ALTER DATABASE postgres SET app\.settings\.jwt_secret TO NULL/)
  })

  it('reloads the PostgreSQL configuration so the change takes effect immediately', () => {
    expect(sql).toMatch(/SELECT pg_reload_conf\(\)/)
  })

  it('does not expose the secret in any client-facing code path', () => {
    // The secret must never appear in a GRANT, a policy, or a comment
    // that could be read by authenticated/anon users.
    expect(sql).not.toMatch(/GRANT.*jwt_secret/)
    expect(sql).not.toMatch(/CREATE POLICY.*jwt_secret/)
  })
})