/**
 * H1 — legacy private API cache cleanup (runs inside the service worker).
 *
 * The previously deployed service worker (workbox runtimeCaching in
 * vite.config.ts) stored every Supabase API response — attendance, teacher,
 * profile, report, notification and auth data — in a runtime cache named
 * `supabase-api`. That cache outlived logout on shared devices.
 *
 * Runtime caching of Supabase traffic has been removed, so this cache is no
 * longer created. This script deletes any `supabase-api` cache left behind
 * on devices that ran the old deployment.
 *
 * Safety properties:
 * - targeted: ONLY the cache names listed in LEGACY_PRIVATE_API_CACHES are
 *   deleted. Workbox precache and any other static cache are untouched.
 * - idempotent: deleting a missing cache is a no-op, so this can run on
 *   every service worker activation (registerType 'autoUpdate').
 * - safe: failures are contained to the cleanup promise and never block
 *   activation of the new service worker's other work.
 */
const LEGACY_PRIVATE_API_CACHES = ['supabase-api']

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(
        LEGACY_PRIVATE_API_CACHES.filter((name) => names.includes(name)).map((name) =>
          caches.delete(name)
        )
      )
    })()
  )
})
