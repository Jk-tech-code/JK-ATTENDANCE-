/**
 * H1 — legacy private API cache cleanup (runs inside the service worker).
 *
 * The previously deployed service worker stored every Supabase API response
 * in a runtime cache named `supabase-api`. That cache outlived logout on
 * shared devices. Runtime caching has been removed; this deletes leftovers.
 *
 * Also clears any stale workbox runtime caches from previous builds to
 * ensure the new precache is used after deployment.
 */
const LEGACY_PRIVATE_API_CACHES = ['supabase-api']

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(
        names
          .filter(
            (name) =>
              LEGACY_PRIVATE_API_CACHES.includes(name) || name.startsWith('wb-')
          )
          .map((name) => caches.delete(name))
      )
      if (self.registration.active) {
        await self.registration.active.skipWaiting()
      }
    })()
  )
})
