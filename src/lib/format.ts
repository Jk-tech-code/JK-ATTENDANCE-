export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })
}

export function formatISODate(date: Date): string {
  // Use local date components (not toISOString) so a check-in at 1am local time
  // is recorded against today's local date, not yesterday's UTC date.
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function minutesToHours(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  return `${h}h ${m}m`
}

// ─── Africa/Nairobi business-date helpers (client-side) ───────
// Mirrors the server-side helpers in supabase/functions/_shared/timezone.ts.
// Uses Intl.DateTimeFormat (IANA-safe, no manual +3 arithmetic).
const BUSINESS_TZ = 'Africa/Nairobi'

/**
 * Return today's date as `YYYY-MM-DD` in Africa/Nairobi using
 * Intl.DateTimeFormat (IANA-safe, no manual +3 arithmetic).
 */
export function todayEatClient(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/**
 * Return the current year and month (1-12) in Africa/Nairobi.
 */
export function currentYearMonthEat(): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TZ,
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(new Date())
  return {
    year: parseInt(parts.find((p) => p.type === 'year')!.value, 10),
    month: parseInt(parts.find((p) => p.type === 'month')!.value, 10),
  }
}
