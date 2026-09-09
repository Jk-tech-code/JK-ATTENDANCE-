/**
 * H1 — defense-in-depth cleanup of private API caches on logout.
 *
 * Primary fix: vite.config.ts no longer configures any Workbox runtime
 * caching, so Supabase API responses (REST, RPC, Auth, Edge Functions) never
 * enter CacheStorage in the first place.
 *
 * This module is the logout-side safety net: when the user signs out, any
 * cache that still holds private Supabase-origin responses is swept:
 * - the legacy `supabase-api` runtime cache (deployed devices that ran the
 *   old service worker), and
 * - any other cache on this origin containing Supabase-origin responses
 *   (removes entries the legacy runtime cache may have spilled into the
 *   default Workbox runtime cache).
 *
 * Safety properties:
 * - Origin-scoped: only caches on the app's own origin are touched; the
 *   HTTPS Supabase origin itself is never reachable from CacheStorage.
 * - Targeted: only responses whose URL belongs to the private Supabase
 *   project are deleted. Static assets (Workbox precache, JS/CSS, fonts,
 *   icons, images, app shell) are preserved.
 * - Idempotent and silent: safe to call on every SIGNED_OUT event; missing
 *   CacheStorage API support is a no-op; failures are contained.
 * - Fire-and-forget from the caller: Supabase auth callbacks stay
 *   synchronous and race-free (this function is never awaited inside
 *   onAuthStateChange).
 *
 * Edge Functions responses are intentionally NOT covered by the origin
 * match: they live on the Supabase functions domain, never enter
 * CacheStorage (no runtime caching is configured), and deleting app-origin
 * entries can never affect them.
 */

const LEGACY_PRIVATE_API_CACHE_NAMES = ['supabase-api']

/** Hostname of the private Supabase project whose responses must never persist. */
const SUPABASE_HOST_PATTERN = /(^|\.)ireyodsiyvvjfqymgdpa\.supabase\.co$/i

function isPrivateSupabaseUrl(url: URL): boolean {
  return SUPABASE_HOST_PATTERN.test(url.hostname)
}

/** True only when CacheStorage is available (window or service worker context). */
export function isCacheStorageSupported(): boolean {
  return typeof caches !== 'undefined'
}

/**
 * Sweep private Supabase API responses out of CacheStorage.
 *
 * Never throws. Returns a summary of what was removed (for tests and
 * debugging); callers should not block UI on the promise.
 */
export async function cleanupPrivateApiCaches(): Promise<{
  legacyCachesDeleted: string[]
  entriesRemoved: number
}> {
  const result = { legacyCachesDeleted: [] as string[], entriesRemoved: 0 }
  if (!isCacheStorageSupported()) return result

  try {
    const cacheNames = await caches.keys()

    // 1. Delete legacy private API caches by name (targeted, idempotent).
    await Promise.all(
      LEGACY_PRIVATE_API_CACHE_NAMES.map(async (name) => {
        if (!cacheNames.includes(name)) return
        await caches.delete(name)
        result.legacyCachesDeleted.push(name)
      })
    )

    // 2. Sweep Supabase-origin responses out of any remaining cache on this
    //    origin (e.g. the legacy cache's spill-over into workbox runtime
    //    caches). Static caches without such entries are left untouched.
    await Promise.all(
      cacheNames
        .filter((name) => !LEGACY_PRIVATE_API_CACHE_NAMES.includes(name))
        .map(async (name) => {
          const cache = await caches.open(name)
          const requests = await cache.keys()
          const stale = requests.filter((r) => {
            try {
              return isPrivateSupabaseUrl(new URL(r.url))
            } catch {
              return false
            }
          })
          await Promise.all(stale.map((r) => cache.delete(r)))
          result.entriesRemoved += stale.length
        })
    )
  } catch {
    // CacheStorage unavailable, partitioned, or transient failure:
    // never let cleanup break logout.
  }

  return result
}
