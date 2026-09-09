import { test, expect, type Route } from '@playwright/test'

/**
 * H1 — PWA cache security browser verification (Phase 2).
 *
 * Runs against the PRODUCTION build served by `vite preview` (the service
 * worker is only generated and registered in production builds). Start it
 * with:
 *
 *   npm run build && npx vite preview --port 5173 --strictPort
 *
 * Then `npm run test:e2e`.
 *
 * ─── Dedicated E2E test account ───────────────────────────────────────────
 * The app under test is wired to the real hosted Supabase project. Creating
 * a real account there — or sending ANY automated traffic to it — is not
 * allowed. Instead, this spec fulfils every `*.supabase.co` request locally
 * with fixtures for a DEDICATED fake account:
 *
 *     email:    e2e-cache-probe@test.local
 *     password: H1-e2e-cache-probe-2026!
 *
 * The account exists only inside these route handlers (no server-side
 * account, no production credentials, zero production traffic). Everything
 * else is real: the built app, the service worker, CacheStorage, the fetch
 * path — so the cache-security contract is exercised end to end.
 *
 * What is verified in a real browser:
 *  - the service worker activates (PWA still functional),
 *  - the static precache exists (static assets remain cacheable),
 *  - the legacy `supabase-api` runtime cache never exists,
 *  - after a real login + private data load + logout, no cache on this
 *    origin contains any Supabase-origin response.
 */

const MOCK_EMAIL = 'e2e-cache-probe@test.local'
const MOCK_PASSWORD = 'H1-e2e-cache-probe-2026!'
const USER_ID = 'e2e-user-1'
const ACCESS_TOKEN = 'e2e-access-token'
const REFRESH_TOKEN = 'e2e-refresh-token'

const MOCK_USER = {
  id: USER_ID,
  aud: 'authenticated',
  role: 'authenticated',
  email: MOCK_EMAIL,
  phone: '',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: { full_name: 'E2E Cache Probe' },
  identities: [],
  created_at: '2026-09-10T00:00:00Z',
  updated_at: '2026-09-10T00:00:00Z',
}

const SESSION = {
  access_token: ACCESS_TOKEN,
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: REFRESH_TOKEN,
  user: MOCK_USER,
}

const TEACHER = {
  id: USER_ID,
  user_id: USER_ID,
  auth_user_id: USER_ID,
  full_name: 'E2E Cache Probe',
  email: MOCK_EMAIL,
  role: 'teacher',
  staff_number: 'E2E-001',
  department: 'QA',
  status: 'active',
  reporting_time: '08:00:00',
  created_at: '2026-09-10T00:00:00Z',
}

const ATTENDANCE = [
  {
    id: 'e2e-att-1',
    teacher_id: USER_ID,
    date: '2026-09-10',
    check_in_time: '08:05:00',
    check_out_time: null,
    status: 'checked_in',
    late_minutes: 5,
    created_at: '2026-09-10T08:05:00Z',
  },
]

/** Call counters proving the login / data / logout flow actually ran. */
const hits = { token: 0, user: 0, logout: 0, rest: 0 }

/** Local fulfilment of every Supabase request — nothing reaches the real API. */
async function handleSupabaseRoute(route: Route): Promise<void> {
  const req = route.request()
  const url = new URL(req.url())
  const path = url.pathname
  const json = (status: number, body: unknown) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

  // ── Auth ──────────────────────────────────────────────────────────────
  if (path === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
    hits.token++
    const body = req.postDataJSON() as { email?: string; password?: string }
    if (body.email === MOCK_EMAIL && body.password === MOCK_PASSWORD) return json(200, SESSION)
    return json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' })
  }
  if (path === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
    return json(200, SESSION)
  }
  if (path === '/auth/v1/user') {
    const auth = req.headers()['authorization'] ?? ''
    if (auth === `Bearer ${ACCESS_TOKEN}`) {
      hits.user++
      return json(200, { user: MOCK_USER })
    }
    // No session (initial load): unauthenticated, as the real API would be.
    return json(401, { code: 401, error_code: 'invalid_claim', msg: 'Invalid JWT' })
  }
  if (path === '/auth/v1/logout') {
    hits.logout++
    return route.fulfill({ status: 204 })
  }
  if (path === '/auth/v1/health') return json(200, { version: 'e2e-mock' })

  // ── REST (PostgREST) ─────────────────────────────────────────────────
  if (path === '/rest/v1/teachers') {
    // .maybeSingle() teacher lookup for the dedicated E2E account.
    hits.rest++
    return json(200, TEACHER)
  }
  if (path === '/rest/v1/attendance') {
    // Private attendance rows (the data that must never be cached).
    hits.rest++
    return json(200, ATTENDANCE)
  }
  if (path.startsWith('/rest/v1/rpc/')) {
    hits.rest++
    return json(200, null)
  }
  if (path.startsWith('/rest/v1/')) {
    hits.rest++
    const accept = req.headers()['accept'] ?? ''
    if (accept.includes('vnd.pgrst.object')) {
      // Emulate PostgREST "0 rows" for .maybeSingle() → supabase-js maps to data:null.
      return json(406, {
        code: 'PGRST116',
        message: 'JSON object requested, multiple (or no) rows returned',
        details: 'The result contains 0 rows',
        hint: null,
      })
    }
    return json(200, [])
  }

  // ── Edge Functions / Storage / anything else on the Supabase host ────
  return json(200, {})
}

/** Read every cache name and every request URL stored on this origin. */
async function inspectCacheStorage(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const names = await caches.keys()
    const entries: Record<string, string[]> = {}
    for (const name of names) {
      const cache = await caches.open(name)
      entries[name] = (await cache.keys()).map((r) => r.url)
    }
    return { names, entries }
  })
}

const supabaseUrlsIn = (c: { entries: Record<string, string[]> }) =>
  Object.values(c.entries)
    .flat()
    .filter((u) => /supabase\.co/i.test(u))

test.beforeEach(async ({ context }) => {
  // Isolate ALL tests from the real Supabase project (zero production traffic).
  hits.token = 0
  hits.user = 0
  hits.logout = 0
  hits.rest = 0
  await context.route('https://*.supabase.co/**', handleSupabaseRoute)
  // Realtime opens a WebSocket, which request routing cannot intercept.
  // Intercept the socket and never connect it to a server: the app works,
  // and no connection is made to the real realtime endpoint.
  await context.routeWebSocket(/\/realtime\/v1\/websocket/, () => {})
})

test.describe('H1: service worker cache policy (production build)', () => {
  test('service worker activates and static precache is present', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('load')

    const active = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false
      const reg = await navigator.serviceWorker.ready
      return Boolean(reg.active)
    })
    expect(active).toBe(true)

    const { names, entries } = await inspectCacheStorage(page)

    // Static caching still works: a Workbox precache cache exists and holds
    // app-shell/static assets.
    const precacheName = names.find((n) => n.includes('workbox-precache'))
    expect(precacheName, 'static precache cache should exist').toBeTruthy()
    const precacheUrls = entries[precacheName!] ?? []
    expect(precacheUrls.length, 'precache should contain static assets').toBeGreaterThan(0)
    expect(precacheUrls.some((u) => /\.(js|css|png|ico|html)(\?|$)/.test(u))).toBe(true)
  })

  test('legacy supabase-api cache does not exist after service worker activation', async ({
    page,
  }) => {
    await page.goto('/')
    await page.waitForLoadState('load')
    await page.evaluate(async () => {
      if ('serviceWorker' in navigator) await navigator.serviceWorker.ready
    })

    const { names, entries } = await inspectCacheStorage(page)

    expect(names).not.toContain('supabase-api')
    // No cache on this origin may contain any Supabase-origin response.
    const supabaseUrls = supabaseUrlsIn({ entries })
    expect(
      supabaseUrls,
      `private API responses leaked into CacheStorage: ${supabaseUrls.join(', ')}`
    ).toEqual([])
  })
})

test.describe('H1: authenticated login → private data → logout (dedicated E2E account)', () => {
  test('login, private data load and logout leave no private API cache', async ({ page }) => {
    await page.goto('/login')
    await page.waitForLoadState('load')
    // Ensure the new service worker is active BEFORE the session starts so
    // every login/data request flows through it.
    await page.evaluate(async () => {
      if ('serviceWorker' in navigator) await navigator.serviceWorker.ready
    })

    // ── 1–2. Login as the dedicated E2E account ─────────────────────────
    await page.locator('#email').fill(MOCK_EMAIL)
    await page.locator('#password').fill(MOCK_PASSWORD)
    await page.getByRole('button', { name: /sign in/i }).click()
    await page.waitForURL('**/dashboard', { timeout: 20000 })

    // ── 3–4. Private data flowed through the browser (fulfilled locally) ─
    await expect
      .poll(() => hits.token, { timeout: 15000 })
      .toBeGreaterThan(0)
    await expect
      .poll(() => hits.rest, { timeout: 15000 })
      .toBeGreaterThan(0)

    // While logged in: no Supabase-origin response may sit in any cache.
    let cache = await inspectCacheStorage(page)
    expect(cache.names).not.toContain('supabase-api')
    const urlsWhileLoggedIn = supabaseUrlsIn(cache)
    expect(
      urlsWhileLoggedIn,
      `private API responses leaked into CacheStorage while logged in: ${urlsWhileLoggedIn.join(', ')}`
    ).toEqual([])

    // ── 5–6. Logout ─────────────────────────────────────────────────────
    await page.getByLabel('Sign out').click()
    await page.waitForURL(/\/login/, { timeout: 20000 })
    await expect.poll(() => hits.logout, { timeout: 15000 }).toBeGreaterThan(0)
    // Give the SIGNED_OUT sweep (fire-and-forget) a moment to complete.
    await page.waitForTimeout(500)

    // ── 7–9. After logout: no private API cache remains, statics intact ──
    cache = await inspectCacheStorage(page)
    expect(cache.names).not.toContain('supabase-api')
    const urlsAfterLogout = supabaseUrlsIn(cache)
    expect(
      urlsAfterLogout,
      `private API responses survived logout in CacheStorage: ${urlsAfterLogout.join(', ')}`
    ).toEqual([])
    expect(cache.names.some((n) => n.includes('workbox-precache'))).toBe(true)
  })
})
