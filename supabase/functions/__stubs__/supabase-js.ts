// Test-friendly stub for `jsr:@supabase/supabase-js@2`.
//
// The real package only runs in Deno. Under Node we replace its
// surface with a mutable globalThis handle that individual tests can
// drive directly. This is more robust than vi.mock('jsr:...') because
// vitest's `vi.mock` keys don't survive Vite's import-resolution
// aliasing in every version.

type ClientShape = {
  auth: { getUser: (token: string) => Promise<{ data: { user: unknown }; error: unknown }> }
  rpc: (name: string, args?: unknown) => Promise<{ data: unknown; error: unknown }>
  from: (table: string) => unknown
}

declare global {
  // eslint-disable-next-line no-var
  var __MOCK_SUPABASE__: {
    createClient: (...args: unknown[]) => ClientShape
    getUser: (token: string) => Promise<{ data: { user: unknown }; error: unknown }>
    rpc: (name: string, args?: unknown) => Promise<{ data: unknown; error: unknown }>
    from: (table: string) => unknown
    reset: () => void
  }
}

if (!globalThis.__MOCK_SUPABASE__) {
  globalThis.__MOCK_SUPABASE__ = {
    createClient: (..._args: unknown[]) => {
      throw new Error('supabase-js stub: tests must configure __MOCK_SUPABASE__.createClient')
    },
    getUser: async () => ({ data: { user: null }, error: null }),
    rpc: async () => ({ data: null, error: null }),
    from: (_table: string) => {
      throw new Error('supabase-js stub: tests must configure __MOCK_SUPABASE__.from')
    },
    reset() {
      this.createClient = () => {
        throw new Error('supabase-js stub: reset() called before configure()')
      }
    },
  }
}

export function createClient(...args: unknown[]): ClientShape {
  return globalThis.__MOCK_SUPABASE__.createClient(...args)
}
