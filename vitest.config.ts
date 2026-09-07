import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Replace Deno-only `jsr:@supabase/...` specifiers with local stubs
      // so vite can resolve them under Node and tests can vi.mock the
      // stub paths by their absolute or relative form.
      'jsr:@supabase/supabase-js@2': path.resolve(
        __dirname,
        './supabase/functions/__stubs__/supabase-js.ts',
      ),
      'jsr:@supabase/functions-js/edge-runtime.d.ts': path.resolve(
        __dirname,
        './supabase/functions/__stubs__/edge-runtime.ts',
      ),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'supabase/functions/**/*.{test,spec}.ts'],
    // Inline the stub so vi.mock can intercept it. Without this, vitest
    // caches the resolved module and vi.mock has no effect.
    server: {
      deps: {
        inline: [/\/supabase\/functions\/__stubs__\//],
      },
    },
  },
})
