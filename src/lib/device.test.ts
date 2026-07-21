import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Device and browser detection tests.
 *
 * Tests the detectDevice() and detectBrowser() functions from
 * src/lib/device.ts by mocking navigator.userAgent for various
 * device/browser combinations.
 */

// Store original navigator properties
const originalNavigator = globalThis.navigator

function mockUserAgent(ua: string, maxTouchPoints = 0, innerWidth = 1920) {
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      userAgent: ua,
      maxTouchPoints,
    },
    configurable: true,
    writable: true,
  })
  // Also mock window.innerWidth via Object.defineProperty on globalThis
  // (vitest's jsdom environment provides window)
  Object.defineProperty(globalThis, 'innerWidth', {
    value: innerWidth,
    configurable: true,
    writable: true,
  })
}

afterEach(() => {
  // Restore original navigator
  Object.defineProperty(globalThis, 'navigator', {
    value: originalNavigator,
    configurable: true,
  })
})

describe('detectDevice', () => {
  beforeEach(() => {
    // Re-import with fresh mocks each time
    vi.resetModules()
  })

  it('detects Mobile from iPhone', async () => {
    mockUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    )
    const { detectDevice } = await import('./device')
    expect(detectDevice()).toBe('Mobile')
  })

  it('detects Mobile from Android phone', async () => {
    mockUserAgent(
      'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36',
      5,  // maxTouchPoints
    )
    const { detectDevice } = await import('./device')
    expect(detectDevice()).toBe('Mobile')
  })

  it('detects Mobile from Windows Phone', async () => {
    mockUserAgent(
      'Mozilla/5.0 (Windows Phone 10.0; Android 6.0.1; Microsoft; RM-1152) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/52.0.2743.116 Mobile Safari/537.36 Edge/15.14900',
    )
    const { detectDevice } = await import('./device')
    expect(detectDevice()).toBe('Mobile')
  })

  it('detects Tablet from iPad (Chrome on iPadOS)', async () => {
    // Use Chrome on iPad UA which doesn't include the 'Mobile' token
    mockUserAgent(
      'Mozilla/5.0 (iPad; CPU OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.109 Safari/604.1',
    )
    const { detectDevice } = await import('./device')
    expect(detectDevice()).toBe('Tablet')
  })

  it('detects Tablet from Android tablet', async () => {
    mockUserAgent(
      'Mozilla/5.0 (Linux; Android 14; SM-X910) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Safari/537.36',
    )
    const { detectDevice } = await import('./device')
    expect(detectDevice()).toBe('Tablet')
  })

  it('detects Desktop from Windows Chrome', async () => {
    mockUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      0,  // no touch
    )
    const { detectDevice } = await import('./device')
    expect(detectDevice()).toBe('Desktop')
  })

  it('detects Desktop from Mac Firefox', async () => {
    mockUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0',
      0,  // no touch
    )
    const { detectDevice } = await import('./device')
    expect(detectDevice()).toBe('Desktop')
  })

  it('detects Laptop when touch supported but small screen', async () => {
    mockUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      5,   // has touch
      800, // small screen so innerWidth < 1024 falls through to Laptop path
    )
    const { detectDevice } = await import('./device')
    // maxTouchPoints > 0 and not mobile/tablet => Laptop
    expect(detectDevice()).toBe('Laptop')
  })
})

describe('detectBrowser', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('detects Chrome desktop', async () => {
    mockUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    )
    const { detectBrowser } = await import('./device')
    expect(detectBrowser()).toBe('Chrome')
  })

  it('detects Chrome on Android', async () => {
    mockUserAgent(
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36',
    )
    const { detectBrowser } = await import('./device')
    expect(detectBrowser()).toBe('Chrome')
  })

  it('detects Edge', async () => {
    mockUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
    )
    const { detectBrowser } = await import('./device')
    expect(detectBrowser()).toBe('Edge')
  })

  it('detects Firefox', async () => {
    mockUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
    )
    const { detectBrowser } = await import('./device')
    expect(detectBrowser()).toBe('Firefox')
  })

  it('detects Safari on Mac', async () => {
    mockUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    )
    const { detectBrowser } = await import('./device')
    expect(detectBrowser()).toBe('Safari')
  })

  it('detects Safari on iPhone', async () => {
    mockUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    )
    const { detectBrowser } = await import('./device')
    expect(detectBrowser()).toBe('Safari')
  })

  it('detects Opera', async () => {
    mockUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0',
    )
    const { detectBrowser } = await import('./device')
    expect(detectBrowser()).toBe('Opera')
  })

  it('returns Unknown for unrecognized user agent', async () => {
    mockUserAgent('SomeRandomBrowser/1.0')
    const { detectBrowser } = await import('./device')
    expect(detectBrowser()).toBe('Unknown')
  })
})

describe('getDeviceInfo', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns device and browser info', async () => {
    mockUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      0,  1920,
    )
    const { getDeviceInfo } = await import('./device')
    const info = getDeviceInfo()

    expect(info).toHaveProperty('device')
    expect(info).toHaveProperty('browser')
    expect(typeof info.device).toBe('string')
    expect(typeof info.browser).toBe('string')
  })
})
