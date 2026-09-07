import { useEffect, useState } from 'react'

/**
 * Count down to a fixed expiry timestamp. Returns the remaining time
 * in whole seconds, or null when the target is null/expired.
 *
 * Cleans up its own interval and handles clock skew by clamping to
 * zero instead of going negative.
 */
export function useCountdownTo(expiresAt: string | null | undefined): number | null {
  const [seconds, setSeconds] = useState<number | null>(null)

  useEffect(() => {
    if (!expiresAt) {
      setSeconds(null)
      return
    }
    const tick = () => {
      const remaining = Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000))
      setSeconds(remaining)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [expiresAt])

  return seconds
}

/**
 * Decrement a numeric seconds value once per second until it hits 0,
 * then return null. Used to drive a "Retry in Ns" UI from a server-
 * supplied `retryAfter` value.
 */
export function useRetryCountdown(retryAfter: number | null | undefined): number | null {
  const [seconds, setSeconds] = useState<number | null>(null)

  useEffect(() => {
    if (!retryAfter || retryAfter <= 0) {
      setSeconds(null)
      return
    }
    setSeconds(retryAfter)
    const id = setInterval(() => {
      setSeconds((prev) => (prev === null || prev <= 1 ? null : prev - 1))
    }, 1000)
    return () => clearInterval(id)
  }, [retryAfter])

  return seconds
}
