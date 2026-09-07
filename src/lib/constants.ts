/**
 * Application-wide constants.
 *
 * Magic numbers that appeared in more than one place (or that
 * represented a contract with the database / a service-side
 * limit) are centralised here so a single edit propagates to
 * every call site.
 *
 * For one-off magic numbers that are intrinsic to a single
 * calculation (e.g. `60 * 60 * 1000` in a time format helper) the
 * literal is fine; this file is for the cross-cutting values.
 */

// ─── GPS / location ─────────────────────────────────────────
// Maximum acceptable horizontal accuracy for a check-in, in
// metres. The check_in_with_location RPC also enforces this;
// the client value is a pre-filter so the user gets a fast error
// before the network round-trip.
export const GPS_ACCURACY_THRESHOLD_M = 50

// ─── Check-out undo window ───────────────────────────────────
// Number of minutes after check-out during which the user may
// undo via the undo RPC. Must match the SQL `v_now + INTERVAL '5
// minutes'` in migration 00041_search_path_hardening.sql.
export const UNDO_WINDOW_MINUTES = 5

// ─── Rate limiting ──────────────────────────────────────────
// The check_in_with_location RPC enforces a sliding window. These
// values are used by the client to display "X attempts remaining"
// and to drive the retry countdown.
export const RATE_LIMIT_MAX_ATTEMPTS = 5
export const RATE_LIMIT_WINDOW_SECONDS = 300 // 5 minutes

// ─── Default schedule ───────────────────────────────────────
// Fallback reporting time when school_settings has no row yet.
// Must match the DB default ('07:20' in school_settings if the
// column is otherwise null).
export const DEFAULT_REPORTING_TIME = '07:20'

// ─── UI / reactivity ────────────────────────────────────────
// React Query staleTime. Used by the singleton QueryClient in
// src/lib/queryClient.ts.
export const QUERY_STALE_TIME_MS = 30_000

// Notification GET cap: the attendance-notification Edge
// Function clamps `limit` to this maximum regardless of the
// request value, so the client shouldn't ask for more.
export const NOTIFICATIONS_MAX_LIMIT = 100

// Default page size for paginated queries.
export const DEFAULT_PAGE_SIZE = 20

// Notification list default page size.
export const NOTIFICATIONS_DEFAULT_LIMIT = 20

// Hard cap used by PostgREST; see POSTGREST_MAX_PAGE_SIZE in
// services/admin/attendance.ts.
export const POSTGREST_MAX_PAGE_SIZE_HARD_CAP = 1000
