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
