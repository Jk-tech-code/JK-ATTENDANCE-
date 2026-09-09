/**
 * H1 targeted tests — PWA cache security policy (configuration contract).
 *
 * These tests verify the actual security contract of the PWA/service worker
 * configuration by reading the real project files:
 *
 *  TEST 1: Supabase API is NOT configured for persistent runtime caching.
 *  TEST 2: Authenticated/private API responses cannot be persisted (no
 *          Workbox strategy is attached to any runtime request pattern).
 *  TEST 3: Legacy private cache cleanup exists where required.
 *  TEST 4: Static assets remain cacheable (precache still configured).
 *  TEST 5: Supabase Auth endpoints are not cached.
 *  TEST 6: Private attendance/teacher/report data receives no cache strategy.
 *
 * TEST 2 (runtime behaviour of the logout sweep) lives in
 * privateCacheCleanup.test.ts; this file pins the configuration contract.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (p: string) => readFileSync(join(root, p), 'utf8')

/** Strip // line comments so prose in source comments cannot satisfy security assertions. */
function stripComments(src: string): string {
  return src.replace(/^\s*\/\/.*$/gm, '')
}

/** Extract the `workbox:` config object from vite.config.ts (the file is TS). */
function extractWorkboxConfig(): string {
  const src = read('vite.config.ts')
  const start = src.indexOf('workbox:')
  expect(start).toBeGreaterThan(-1)
  // Find the matching closing brace of `workbox: { ... }`.
  let depth = 0
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++
    if (src[i] === '}') {
      depth--
      if (depth === 0) return stripComments(src.slice(start, i + 1))
    }
  }
  return src.slice(start)
}

describe('H1: PWA runtime caching security policy (vite.config.ts)', () => {
  const workbox = extractWorkboxConfig()

  it('TEST 1: Supabase API is NOT configured for persistent runtime caching', () => {
    // No Workbox runtime caching is configured at all — nothing can persist
    // Supabase API responses.
    expect(workbox).not.toMatch(/runtimeCaching/)
    // Structural proof: no runtime rule ever declares a handler or urlPattern.
    expect(workbox).not.toMatch(/handler\s*:/)
    expect(workbox).not.toMatch(/urlPattern\s*:/)
    // The old cache name must not appear outside explanatory comments.
    expect(stripComments(read('vite.config.ts'))).not.toMatch(/supabase-api/)
  })

  it('TEST 2: no Workbox strategy (NetworkFirst/CacheFirst/SWR) can persist private API responses', () => {
    // The previous vulnerable handler and every other persistent strategy
    // are absent — private API responses can never enter CacheStorage.
    expect(workbox).not.toMatch(/\bNetworkFirst\b/)
    expect(workbox).not.toMatch(/\bCacheFirst\b/)
    expect(workbox).not.toMatch(/\bStaleWhileRevalidate\b/)
    // Strategies are declared via `handler: '<Strategy>'`; none may exist.
    expect(workbox).not.toMatch(/handler\s*:\s*['"]/) 
  })

  it('TEST 3: legacy private cache cleanup is wired into the service worker', () => {
    // The generated service worker imports a dedicated cleanup script at
    // startup (runs its activate listener on every activation; autoUpdate).
    expect(workbox).toMatch(/importScripts:\s*\['\.\/sw-cache-cleanup\.js'\]/)
    // The cleanup script must exist and delete ONLY the legacy private API
    // cache, never the Workbox/static caches.
    const cleanup = read('public/sw-cache-cleanup.js')
    expect(cleanup).toMatch(/LEGACY_PRIVATE_API_CACHES\s*=\s*\[\s*'supabase-api'\s*\]/)
    expect(cleanup).toMatch(/addEventListener\(\s*'activate'/)
    expect(cleanup).toMatch(/caches\.delete\(name\)/)
    expect(cleanup).not.toMatch(/workbox-precache/i)
  })

  it('TEST 4: static assets remain cacheable (precache manifest still configured)', () => {
    expect(workbox).toMatch(/globPatterns:\s*\['\*\*\/\*\.\{js,css,html,png,ico\}'\]/)
  })

  it('TEST 5: Supabase Auth endpoints receive no caching rule', () => {
    // /auth/v1/* fell under the old wildcard rule; with runtimeCaching
    // removed there is no rule left that could match auth endpoints.
    expect(workbox).not.toMatch(/auth\/v1/)
    expect(workbox).not.toMatch(/urlPattern/)
  })

  it('TEST 6: private attendance/teacher/report data receives no cache strategy', () => {
    // These endpoints were all matched by the removed wildcard rule; verify
    // no per-endpoint caching rule exists for any of them.
    for (const path of ['rest/v1/attendance', 'rest/v1/teachers', 'rest/v1/profiles', 'rest/v1/report', 'rest/v1/notifications']) {
      expect(workbox).not.toContain(path)
    }
  })
})

describe('H1: logout defense-in-depth wiring', () => {
  it('SIGNED_OUT and explicit signOut both trigger the private cache sweep', () => {
    const authProvider = read('src/contexts/AuthProvider.tsx')
    // Both logout paths call the cleanup.
    const sweepCalls = authProvider.split('cleanupPrivateApiCaches()').length - 1
    expect(sweepCalls).toBeGreaterThanOrEqual(2)
    // Called fire-and-forget inside the auth listener (no await, no race).
    expect(authProvider).toMatch(/void cleanupPrivateApiCaches\(\)/)
    // Module must be the one under test.
    expect(authProvider).toMatch(/from '@\/lib\/privateCacheCleanup'/)
  })

  it('the cleanup module is origin-scoped to the private Supabase project', () => {
    const mod = read('src/lib/privateCacheCleanup.ts')
    // Pins the exact project ref (regex-source form in the module).
    expect(mod).toMatch(/SUPABASE_HOST_PATTERN = \/\(\^\|\\\.\)ireyodsiyvvjfqymgdpa\\\.supabase\\\.co\$\/i/)
    // Deletion must be name- or URL-targeted, never cache-wide.
    expect(mod).toMatch(/cache\.delete\(/)
  })
})
