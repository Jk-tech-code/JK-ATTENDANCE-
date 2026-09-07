# ADR 0002 — Remove `record-attendance` edge function and `recordAttendance` client helper

**Status:** Accepted, 2026-09-04

## Context

Migration `00048_attendance_writes_via_rpc_only.sql` is the security
backbone of the attendance table: it drops the
"Teachers manage own attendance FOR ALL" policy and replaces it with a
SELECT-only policy plus an explicit
`REVOKE INSERT, UPDATE, DELETE ON public.attendance FROM authenticated, anon`.

The intent: every write to the attendance table must go through a
SECURITY DEFINER RPC — primarily `check_in_with_location`, which
validates GPS accuracy, school-radius distance, late-minute
calculation, and rate limiting in one atomic call. The RPC runs as
the function owner, bypasses RLS, and writes a row whose contents
the caller could not have produced by direct INSERT.

`record-attendance` (the edge function) and `src/services/attendanceApi.ts::recordAttendance`
(the client wrapper) were an *alternative* write path: admin-only,
but writing directly via `from('attendance').insert(...)` /
`.update(...)`. This path skipped GPS validation, radius checks,
late-minute math, and rate limiting. In the threat model, an admin
who shouldn't be able to backfill a fraudulent attendance record for
a teacher could.

The conflict: migration 00048's REVOKE applies to `authenticated` and
`anon`, but `record-attendance` uses `createSupabaseAdmin()` (the
service role) which retains write access. The lock-down therefore
does *not* stop the bypass. The function is also admin-gated, so
non-admin callers can't reach it, but the write path still exists
for the one role that shouldn't have it.

## Decision

Delete the function, its config entry, and the dead client helper.
The only remaining write paths to `public.attendance` are the
SECURITY DEFINER RPCs.

The function had **zero callers** in the codebase: `recordAttendance`
was exported by `attendanceApi.ts` but no UI component, hook, or
service imported it. The real attendance flow routes through
`checkInWithLocation`, `checkOut`, and `undoCheckOut` from
`src/services/attendance.ts`.

## Consequences

- The `record-attendance` Edge Function no longer deploys, removing
  the service-role write path.
- `src/services/attendanceApi.ts` is slightly smaller. The
  `RecordAttendanceInput` type was deleted (it was defined but not
  used outside the dead helper). A doc comment in the same file
  points future contributors at the correct RPC wrappers.
- Any future "admin backfill" use case should go through a new
  SECURITY DEFINER RPC that explicitly carries the admin override
  flag in its audit log — not by re-introducing a service-role
  write.
- `supabase/functions/smoke.test.ts` no longer imports the deleted
  function; the test count drops by 2 cases (from 22 to 20 in that
  file).