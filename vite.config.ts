import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import sitemap from 'vite-plugin-sitemap'
import path from 'path'
import { loadEnv } from 'vite'

const env = loadEnv('', process.cwd(), '')
const requiredEnvVars = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']
for (const envVar of requiredEnvVars) {
  if (!env[envVar]) {
    console.warn(
      `Warning: ${envVar} is not set. Build will proceed but app may not work at runtime.`
    )
  }
}
const siteUrl = env.VITE_SITE_URL || 'https://jk-attendance.vercel.app'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'pwa-192x192.png', 'pwa-512x512.png'],
      manifest: {
        name: 'JK Attendance System',
        short_name: 'JK Attendance',
        description: 'GPS-based attendance tracking for Glorious Group of Schools',
        theme_color: '#0f172a',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        id: '/',
        scope: '/',
        categories: ['education', 'productivity'],
        prefer_related_applications: false,
        icons: [
          { src: 'favicon.png', sizes: '32x32', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        screenshots: [
          {
            src: 'og-image.png',
            sizes: '1200x630',
            type: 'image/png',
            form_factor: 'wide',
            label: 'JK Attendance System Dashboard',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,ico}'],
        // H1 security fix: no runtime caching at all. The previous
        // NetworkFirst rule persisted every Supabase response (attendance,
        // teacher, profile, report and auth data) in a `supabase-api`
        // CacheStorage cache that outlived logout on shared devices.
        // Supabase API traffic is now strictly network-only; static app
        // assets remain precached via globPatterns. This script deletes the
        // legacy `supabase-api` cache left on devices that ran the old
        // deployment (runs on service worker activation, autoUpdate).
        importScripts: ['./sw-cache-cleanup.js'],
      },
    }),
    sitemap({
      hostname: siteUrl,
      readable: true,
      dynamicRoutes: ['/', '/login', '/help'],
      exclude: ['/admin/*', '/dashboard', '/reset-password', '/forgot-password'],
      generateRobotsTxt: false,
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  build: {
    reportCompressedSize: false,
    target: 'es2023',
    minify: 'esbuild',
    cssMinify: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/'))
            return 'vendor-react'
          if (id.includes('node_modules/react-router')) return 'vendor-router'
          if (
            id.includes('node_modules/lucide-react') ||
            id.includes('node_modules/sonner') ||
            id.includes('node_modules/class-variance-authority')
          )
            return 'vendor-ui'
          if (id.includes('node_modules/recharts')) return 'vendor-charts'
          if (id.includes('node_modules/jspdf')) return 'vendor-pdf'
          if (id.includes('node_modules/xlsx')) return 'vendor-xlsx'
          if (id.includes('node_modules/@supabase')) return 'vendor-supabase'
          if (id.includes('node_modules/@tanstack')) return 'vendor-query'
        },
      },
    },
    chunkSizeWarningLimit: 500,
  },
})
