import { QueryClient } from '@tanstack/react-query'

/**
 * Single QueryClient instance used by the whole app.
 *
 * Defined as a module-level singleton so AuthProvider (which sits
 * inside QueryClientProvider) can call queryClient.clear() on sign-
 * out and on SIGNED_OUT events without having to pass the client
 * through context. Importing it in main.tsx wires it into
 * QueryClientProvider.
 *
 * Default options: 1 retry, 30s staleTime. Hooks that need different
 * behaviour override per-query.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
})