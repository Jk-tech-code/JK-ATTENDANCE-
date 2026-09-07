import * as Sentry from '@sentry/react'
import { browserTracingIntegration } from '@sentry/react'

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined

function isValidDsn(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed) return false
  if (trimmed === 'https://your-dsn@sentry.io/project-id') return false
  try {
    const url = new URL(trimmed)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

export function initSentry(): void {
  if (!isValidDsn(SENTRY_DSN)) return
  try {
    Sentry.init({
      dsn: SENTRY_DSN,
      integrations: [browserTracingIntegration()],
      tracesSampleRate: 0.1,
      environment: import.meta.env.MODE,
    })
  } catch (err) {
    console.warn('[sentry] initialization failed; continuing without error tracking', err)
  }
}
