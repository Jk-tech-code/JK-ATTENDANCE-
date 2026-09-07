import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    const s = statSync(p)
    if (s.isDirectory()) {
      walk(p, out)
    } else if (/\.(ts|tsx|mjs|js)$/.test(entry)) {
      out.push(p)
    }
  }
  return out
}

describe('frontend secret hygiene', () => {
  it('does not include SUPABASE_SERVICE_ROLE_KEY in any frontend file', () => {
    const files = walk(join(process.cwd(), 'src')).filter(
      (f) => !f.endsWith('frontendSecrets.test.ts')
    )
    const offenders: string[] = []
    for (const f of files) {
      const content = readFileSync(f, 'utf8')
      if (/SUPABASE_SERVICE_ROLE_KEY/.test(content)) {
        offenders.push(f)
      }
    }
    expect(offenders).toEqual([])
  })

  it('does not include a hardcoded service_role JWT in any frontend file', () => {
    const files = walk(join(process.cwd(), 'src')).filter(
      (f) => !f.endsWith('frontendSecrets.test.ts')
    )
    const offenders: string[] = []
    for (const f of files) {
      const content = readFileSync(f, 'utf8')
      if (/service_role/i.test(content) && !/service.role.*auth\.uid\(\)/.test(content)) {
        offenders.push(f)
      }
    }
    expect(offenders).toEqual([])
  })
})
