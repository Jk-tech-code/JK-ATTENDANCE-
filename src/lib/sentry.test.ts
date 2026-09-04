import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const initMock = vi.fn()

vi.mock('@sentry/react', () => ({
  init: (...args: unknown[]) => initMock(...args),
  browserTracingIntegration: () => ({ name: 'BrowserTracing' }),
  captureException: vi.fn(),
}))

describe('initSentry', () => {
  beforeEach(() => {
    initMock.mockReset()
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('does not initialize when VITE_SENTRY_DSN is unset', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', '')
    const { initSentry } = await import('./sentry')
    initSentry()
    expect(initMock).not.toHaveBeenCalled()
  })

  it('does not initialize when DSN is the example placeholder', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://your-dsn@sentry.io/project-id')
    const { initSentry } = await import('./sentry')
    initSentry()
    expect(initMock).not.toHaveBeenCalled()
  })

  it('does not initialize when DSN is not a URL', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'not-a-url')
    const { initSentry } = await import('./sentry')
    initSentry()
    expect(initMock).not.toHaveBeenCalled()
  })

  it('initializes when DSN is a valid https URL', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://e406b00ee253cce786b6d6552292e0bb@o4512028237365248.ingest.de.sentry.io/4512028251848784')
    const { initSentry } = await import('./sentry')
    initSentry()
    expect(initMock).toHaveBeenCalledTimes(1)
  })

  it('swallows initialization errors so the app keeps working', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://e406b00ee253cce786b6d6552292e0bb@o4512028237365248.ingest.de.sentry.io/4512028251848784')
    initMock.mockImplementation(() => {
      throw new Error('Sentry exploded')
    })
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { initSentry } = await import('./sentry')
    expect(() => initSentry()).not.toThrow()
    expect(consoleWarn).toHaveBeenCalled()
    consoleWarn.mockRestore()
  })
})