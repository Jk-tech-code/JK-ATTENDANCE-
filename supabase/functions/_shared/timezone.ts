// ============================================
// JK Attendance - Timezone Utilities
// ============================================
// Kenya is in East Africa Time (EAT) = UTC+3.
// Edge function runtimes may execute in UTC, so we explicitly
// format dates in Africa/Nairobi to avoid off-by-one date bugs
// when cron triggers run near midnight.
// ============================================

const EAT_OFFSET_HOURS = 3

/**
 * Return today's date as `YYYY-MM-DD` in East Africa Time (UTC+3).
 * Uses pure arithmetic — no Intl or toLocaleDateString, which vary
 * across runtimes.
 */
export function todayEat(): string {
  const now = new Date(Date.now() + EAT_OFFSET_HOURS * 60 * 60 * 1000)
  return now.toISOString().slice(0, 10)
}

/**
 * Return the month (1-12) in East Africa Time (UTC+3).
 */
export function currentMonthEat(): number {
  const now = new Date(Date.now() + EAT_OFFSET_HOURS * 60 * 60 * 1000)
  return now.getUTCMonth() + 1
}

/**
 * Return the full year (e.g. 2026) in East Africa Time (UTC+3).
 */
export function currentYearEat(): number {
  const now = new Date(Date.now() + EAT_OFFSET_HOURS * 60 * 60 * 1000)
  return now.getUTCFullYear()
}

/**
 * Compute the last day of a month (1-31) for a given year/month.
 */
export function daysInMonth(year: number, month: number): number {
  // Day 0 of next month = last day of this month.
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * Application/business timezone — IANA identifier.
 * All business-date logic must use this, never hardcoded offsets.
 */
export const BUSINESS_TZ = 'Africa/Nairobi' as const

/**
 * Convert a TIMESTAMPTZ (ISO string or Date) to total minutes since
 * midnight in Africa/Nairobi.  Returns { hours, minutes, totalMinutes }.
 *
 * Uses `Intl.DateTimeFormat` so DST rules (if any future change affects
 * Nairobi) are handled by the runtime's IANA database, not by manual
 * arithmetic.
 */
export function toNairobiMinutes(timestamp: string | Date): {
  hours: number
  minutes: number
  totalMinutes: number
} {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TZ,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(date)

  const h = parseInt(parts.find((p) => p.type === 'hour')!.value, 10)
  const m = parseInt(parts.find((p) => p.type === 'minute')!.value, 10)
  return { hours: h, minutes: m, totalMinutes: h * 60 + m }
}

/**
 * Return today's date as `YYYY-MM-DD` in Africa/Nairobi using
 * Intl.DateTimeFormat (IANA-safe, no manual +3 arithmetic).
 */
export function todayEatIntl(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}
