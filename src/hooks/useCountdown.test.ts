import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import { useCountdownTo, useRetryCountdown } from './useCountdown'

describe('useCountdownTo', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns null when expiresAt is null', () => {
    const { result } = renderHook(() => useCountdownTo(null))
    expect(result.current).toBeNull()
  })

  it('returns null when expiresAt is undefined', () => {
    const { result } = renderHook(() => useCountdownTo(undefined))
    expect(result.current).toBeNull()
  })

  it('returns the remaining whole seconds for a future timestamp', () => {
    const future = new Date(Date.now() + 30_000).toISOString()
    const { result } = renderHook(() => useCountdownTo(future))
    expect(result.current).toBe(30)
  })

  it('decrements as time passes', () => {
    const start = Date.now()
    const future = new Date(start + 10_000).toISOString()
    const { result } = renderHook(() => useCountdownTo(future))

    expect(result.current).toBe(10)
    act(() => {
      vi.advanceTimersByTime(3_000)
    })
    expect(result.current).toBe(7)
  })

  it('clamps to 0 when the expiry has already passed', () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    const { result } = renderHook(() => useCountdownTo(past))
    expect(result.current).toBe(0)
  })

  it('rounds to the nearest whole second', () => {
    const future = new Date(Date.now() + 12_500).toISOString()
    const { result } = renderHook(() => useCountdownTo(future))
    // 12.5s rounds to 13
    expect(result.current).toBe(13)
  })
})

describe('useRetryCountdown', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns null when retryAfter is null', () => {
    const { result } = renderHook(() => useRetryCountdown(null))
    expect(result.current).toBeNull()
  })

  it('returns null when retryAfter is 0 or negative', () => {
    const { result: r0 } = renderHook(() => useRetryCountdown(0))
    expect(r0.current).toBeNull()

    const { result: rNeg } = renderHook(() => useRetryCountdown(-5))
    expect(rNeg.current).toBeNull()
  })

  it('starts at the supplied value and decrements each second', () => {
    const { result } = renderHook(() => useRetryCountdown(60))
    expect(result.current).toBe(60)

    act(() => {
      vi.advanceTimersByTime(5_000)
    })
    expect(result.current).toBe(55)
  })

  it('resets to null when the countdown reaches 0 (no negative values)', () => {
    const { result } = renderHook(() => useRetryCountdown(2))

    act(() => {
      vi.advanceTimersByTime(3_000)
    })
    expect(result.current).toBeNull()
  })

  it('resets to a new value when retryAfter changes', () => {
    let retryAfter: number | null = 30
    const { result, rerender } = renderHook(() => useRetryCountdown(retryAfter))
    expect(result.current).toBe(30)

    act(() => {
      vi.advanceTimersByTime(5_000)
    })
    expect(result.current).toBe(25)

    retryAfter = 10
    rerender()
    expect(result.current).toBe(10)
  })
})
