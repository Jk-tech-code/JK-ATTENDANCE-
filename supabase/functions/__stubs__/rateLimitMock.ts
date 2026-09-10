// Test-only simulation of the H2 distributed rate-limit backend
// (public.consume_rate_limit, migration 00054).
//
// Reproduces the SQL function's fixed-window semantics exactly:
//   * bucket key = namespace:identifier
//   * window_start = floor(now / window) * window
//   * INSERT ... ON CONFLICT DO UPDATE increments under a row lock —
//     simulated by incrementing synchronously before the promise resolves,
//     so concurrent consumers serialize exactly like the database does.
//
// The store lives OUTSIDE any module (like the database), so every "Edge
// Function isolate" (each makeClient() call) observes the same authoritative
// counters. Responses use the real RPC row shape (array + snake_case) so the
// shared client's normalization path is exercised for real.

export interface RecordedCall {
  name: string
  args: Record<string, unknown>
}

type Bucket = { count: number; windowStart: number }

export function createRateLimitBackendMock(options?: { now?: () => number }) {
  // Default: 30s into a 60s window (retry_after on denial = 30).
  let nowFn = options?.now ?? (() => 1_700_000_030_000)
  const buckets = new Map<string, Bucket>()
  const calls: RecordedCall[] = []

  function consume(args: Record<string, unknown>) {
    const key = `${args.p_namespace}:${args.p_identifier}`
    const windowSeconds = args.p_window_seconds as number
    const max = args.p_max_attempts as number
    const nowMs = nowFn()
    const windowMs = windowSeconds * 1000
    const windowStart = Math.floor(nowMs / windowMs) * windowMs
    const nextWindow = windowStart + windowMs

    const bucket = buckets.get(key)
    let count: number
    if (!bucket || bucket.windowStart !== windowStart) {
      count = 1
      buckets.set(key, { count, windowStart })
    } else {
      bucket.count += 1
      count = bucket.count
    }

    if (count > max) {
      return {
        data: [
          {
            allowed: false,
            remaining: 0,
            retry_after: Math.ceil((nextWindow - nowMs) / 1000),
            reset_at: new Date(nextWindow).toISOString(),
          },
        ],
        error: null,
      }
    }
    return {
      data: [
        {
          allowed: true,
          remaining: max - count,
          retry_after: 0,
          reset_at: new Date(nextWindow).toISOString(),
        },
      ],
      error: null,
    }
  }

  function cleanupExpired(): number {
    const nowMs = nowFn()
    let deleted = 0
    for (const [key, bucket] of buckets) {
      if (bucket.windowStart < nowMs - 10 * 60_000) {
        buckets.delete(key)
        deleted++
      }
    }
    return deleted
  }

  /**
   * Build a client shaped like RateLimitRpcClient. Each call represents one
   * Edge Function isolate. `overrides` lets one isolate simulate a backend
   * outage (rpcError) or malformed response.
   */
  function makeClient(overrides?: {
    rpcError?: { message: string } | null
    malformed?: boolean
  }) {
    return {
      rpc: async (name: string, args?: Record<string, unknown>) => {
        calls.push({ name, args: args ?? {} })
        if (overrides?.rpcError) return { data: null, error: overrides.rpcError }
        if (name === 'cleanup_rate_limit_buckets') {
          return { data: cleanupExpired(), error: null }
        }
        if (name !== 'consume_rate_limit') return { data: null, error: null }
        if (overrides?.malformed) return { data: { unexpected: true }, error: null }
        return consume(args ?? {})
      },
    }
  }

  return {
    makeClient,
    /** Every rpc call recorded across all isolates of this backend. */
    calls,
    bucketCount: () => buckets.size,
    bucketKeys: () => Array.from(buckets.keys()),
    getBucket: (key: string) => buckets.get(key),
    setNow: (ms: number) => {
      nowFn = () => ms
    },
    advanceMs: (delta: number) => {
      const base = nowFn()
      nowFn = () => base + delta
    },
    cleanupExpired,
  }
}
