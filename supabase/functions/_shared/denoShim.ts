/**
 * Test-only polyfill for the Deno global. The Deno runtime provides
 * `Deno.env.get(name)`; in Node we expose the same surface backed by
 * `process.env` (with a `Deno.env.set` shim that just calls process.env
 * assignment, so tests can override at runtime).
 */

type DenoEnvLike = {
  get(name: string): string | undefined
  set(name: string, value: string): void
}

declare global {
  // eslint-disable-next-line no-var
  var Deno: {
    env: DenoEnvLike
    serve?: (...args: unknown[]) => unknown
    [key: string]: unknown
  }
}

if (typeof globalThis.Deno === 'undefined') {
  const env: DenoEnvLike = {
    get: (name: string) => process.env[name],
    set: (name: string, value: string) => {
      process.env[name] = value
    },
  }
  // Deliberately do NOT define Deno.serve. Edge functions guard their
  // `Deno.serve(...)` calls with `typeof Deno.serve === "function"`,
  // so omitting it here means the registration is skipped under Node
  // and the imported handler can be called directly by tests.
  globalThis.Deno = { env } as unknown as typeof globalThis.Deno
}

// Mirror the mutable globalThis handle the supabase-js stub uses.
// Tests drive this directly; the stub reads from it on first call.
type MockSupabaseHandle = {
  createClient: (...args: unknown[]) => unknown
  getUser: (token: string) => Promise<{ data: { user: unknown }; error: unknown }>
  rpc: (name: string, args?: unknown) => Promise<{ data: unknown; error: unknown }>
  from: (table: string) => unknown
  reset: () => void
}

declare global {
  // eslint-disable-next-line no-var
  var __MOCK_SUPABASE__: MockSupabaseHandle
}

if (typeof globalThis.__MOCK_SUPABASE__ === 'undefined') {
  globalThis.__MOCK_SUPABASE__ = {
    createClient: () => {
      throw new Error('supabase-js stub: tests must configure __MOCK_SUPABASE__.createClient')
    },
    getUser: async () => ({ data: { user: null }, error: null }),
    rpc: async () => ({ data: null, error: null }),
    from: () => {
      throw new Error('supabase-js stub: tests must configure __MOCK_SUPABASE__.from')
    },
    reset() {
      this.createClient = () => {
        throw new Error('supabase-js stub: reset() called before configure()')
      }
    },
  }
}

export {}
