/**
 * H1 targeted tests — privateCacheCleanup (logout-side CacheStorage sweep).
 *
 * These tests verify the runtime behaviour of the logout cleanup using a
 * mock CacheStorage implementation (jsdom does not implement CacheStorage).
 * They prove: legacy `supabase-api` cache deletion, preservation of static
 * caches and static entries, sweep of Supabase-origin entries (including
 * /auth/v1/* endpoints) from other caches, idempotency, and no-op/safety
 * behaviour when CacheStorage is unsupported or failing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type MockCache = {
  keys: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
}

const mockCaches = {
  keys: vi.fn<() => Promise<string[]>>(),
  open: vi.fn<(name: string) => Promise<MockCache>>(),
  delete: vi.fn<(name: string) => Promise<boolean>>(),
}

vi.stubGlobal('caches', mockCaches)

import { cleanupPrivateApiCaches, isCacheStorageSupported } from './privateCacheCleanup'

/** A request-like object: cache.keys() returns these, cache.match reads .url. */
function req(url: string): Request {
  return new Request(url)
}

function makeCache(entries: Request[]): MockCache {
  const entriesMutable = [...entries]
  return {
    keys: vi.fn(async () => entriesMutable),
    delete: vi.fn(async (r: Request) => {
      const i = entriesMutable.findIndex((e) => e.url === r.url)
      if (i === -1) return false
      entriesMutable.splice(i, 1)
      return true
    }),
  }
}

const STATIC_APP_PRECACHE_URL = 'https://jk-attendance.vercel.app/assets/index-Ck5AeB7p.js'

describe('privateCacheCleanup (H1 logout cleanup)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.stubGlobal('caches', mockCaches)
  })

  it('deletes the legacy supabase-api cache by name', async () => {
    mockCaches.keys.mockResolvedValue(['workbox-precache', 'supabase-api'])
    mockCaches.delete.mockResolvedValue(true)
    mockCaches.open.mockResolvedValue(makeCache([]))

    const result = await cleanupPrivateApiCaches()

    expect(mockCaches.delete).toHaveBeenCalledWith('supabase-api')
    expect(result.legacyCachesDeleted).toEqual(['supabase-api'])
  })

  it('preserves static caches: precache is never deleted by name', async () => {
    mockCaches.keys.mockResolvedValue([
      'workbox-precache-v2',
      'workbox-precache-http://localhost/',
      'supabase-api',
    ])
    mockCaches.delete.mockResolvedValue(true)
    mockCaches.open.mockResolvedValue(makeCache([]))

    await cleanupPrivateApiCaches()

    const deletedNames = mockCaches.delete.mock.calls.map((c) => c[0])
    expect(deletedNames).toEqual(['supabase-api'])
    expect(deletedNames).not.toContain('workbox-precache-v2')
  })

  it('removes Supabase-origin entries from other caches without deleting the cache', async () => {
    const spillOverCache = makeCache([
      req('https://ireyodsiyvvjfqymgdpa.supabase.co/rest/v1/attendance?select=*'),
      req('https://ireyodsiyvvjfqymgdpa.supabase.co/auth/v1/user'),
      req(STATIC_APP_PRECACHE_URL),
    ])
    mockCaches.keys.mockResolvedValue(['workbox-precache-v2'])
    mockCaches.open.mockResolvedValue(spillOverCache)

    const result = await cleanupPrivateApiCaches()

    const deletedUrls = spillOverCache.delete.mock.calls.map((c) => c[0].url)
    expect(deletedUrls).toContain(
      'https://ireyodsiyvvjfqymgdpa.supabase.co/rest/v1/attendance?select=*'
    )
    expect(deletedUrls).toContain('https://ireyodsiyvvjfqymgdpa.supabase.co/auth/v1/user')
    expect(deletedUrls).not.toContain(STATIC_APP_PRECACHE_URL)
    expect(result.entriesRemoved).toBe(2)
  })

  it('sweeps auth endpoints (/auth/v1/token, /auth/v1/user) wherever they are cached', async () => {
    const cache = makeCache([
      req('https://ireyodsiyvvjfqymgdpa.supabase.co/auth/v1/token?grant_type=password'),
      req('https://ireyodsiyvvjfqymgdpa.supabase.co/auth/v1/token?grant_type=refresh_token'),
      req('https://ireyodsiyvvjfqymgdpa.supabase.co/auth/v1/logout'),
    ])
    mockCaches.keys.mockResolvedValue(['workbox-runtime'])
    mockCaches.open.mockResolvedValue(cache)

    const result = await cleanupPrivateApiCaches()

    expect(result.entriesRemoved).toBe(3)
  })

  it('does NOT touch non-Supabase entries in any cache (static assets preserved)', async () => {
    const cache = makeCache([
      req(STATIC_APP_PRECACHE_URL),
      req('https://fonts.gstatic.com/s/font.woff2'),
      req('https://jk-attendance.vercel.app/manifest.webmanifest'),
    ])
    mockCaches.keys.mockResolvedValue(['workbox-precache-v2'])
    mockCaches.open.mockResolvedValue(cache)

    const result = await cleanupPrivateApiCaches()

    expect(cache.delete).not.toHaveBeenCalled()
    expect(result.entriesRemoved).toBe(0)
  })

  it('is idempotent: second run finds nothing to delete', async () => {
    mockCaches.keys.mockResolvedValue(['workbox-precache-v2'])
    mockCaches.open.mockResolvedValue(makeCache([]))

    const first = await cleanupPrivateApiCaches()
    const second = await cleanupPrivateApiCaches()

    expect(first).toEqual({ legacyCachesDeleted: [], entriesRemoved: 0 })
    expect(second).toEqual({ legacyCachesDeleted: [], entriesRemoved: 0 })
  })

  it('no-ops when CacheStorage is unsupported', async () => {
    vi.stubGlobal('caches', undefined)

    expect(isCacheStorageSupported()).toBe(false)
    const result = await cleanupPrivateApiCaches()

    expect(result).toEqual({ legacyCachesDeleted: [], entriesRemoved: 0 })
    expect(mockCaches.keys).not.toHaveBeenCalled()
  })

  it('never throws when CacheStorage fails mid-cleanup (logout must not break)', async () => {
    mockCaches.keys.mockRejectedValue(new Error('SecurityError: partitioned'))

    await expect(cleanupPrivateApiCaches()).resolves.toEqual({
      legacyCachesDeleted: [],
      entriesRemoved: 0,
    })
  })

  it('ignores malformed request URLs instead of throwing', async () => {
    const badRequest = { url: '::not a url::' } as unknown as Request
    const cache = makeCache([badRequest, req(STATIC_APP_PRECACHE_URL)])
    mockCaches.keys.mockResolvedValue(['workbox-precache-v2'])
    mockCaches.open.mockResolvedValue(cache)

    const result = await cleanupPrivateApiCaches()

    expect(result.entriesRemoved).toBe(0)
    expect(cache.delete).not.toHaveBeenCalled()
  })
})
