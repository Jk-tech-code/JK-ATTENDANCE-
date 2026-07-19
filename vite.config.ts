import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import sitemap from 'vite-plugin-sitemap'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import path from 'path'

const requiredEnvVars = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.warn(`Warning: ${envVar} is not set. Build will proceed but app may not work at runtime.`)
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['3_app_icon_ico.png', '4_transparent_background.png'],
      manifest: {
        name: 'JK Attendance System',
        short_name: 'JK Attendance',
        description: 'GPS-based attendance tracking for Glorious Group of Schools',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: '3_app_icon_ico.png', sizes: '32x32', type: 'image/png' },
          { src: '1_full_color_version.png', sizes: '128x128', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,ico}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/ireyodsiyvvjfqymgdpa\.supabase\.co\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-api',
              expiration: { maxEntries: 50, maxAgeSeconds: 300 },
              networkTimeoutSeconds: 10,
            },
          },
        ],
      },
    }),
    sitemap({
      hostname: 'https://jk-attendance-system.netlify.app',
      dynamicRoutes: ['/login', '/forgot-password', '/help'],
      exclude: ['/admin/*', '/dashboard', '/reset-password'],
      generateRobotsTxt: true,
    }),
    ...(process.env.SENTRY_AUTH_TOKEN
      ? [sentryVitePlugin({
          org: process.env.SENTRY_ORG,
          project: process.env.SENTRY_PROJECT,
          authToken: process.env.SENTRY_AUTH_TOKEN,
          sourcemaps: { assets: ['./dist/assets/**'] },
        })]
      : []),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  build: {
    reportCompressedSize: false,
    target: 'es2023',
    minify: 'esbuild',
    cssMinify: true,
    sourcemap: process.env.SENTRY_AUTH_TOKEN ? 'hidden' : false,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) return 'vendor-react'
          if (id.includes('node_modules/react-router')) return 'vendor-router'
          if (id.includes('node_modules/lucide-react') || id.includes('node_modules/sonner')) return 'vendor-ui'
          if (id.includes('node_modules/recharts')) return 'vendor-charts'
          if (id.includes('node_modules/jspdf')) return 'vendor-pdf'
          if (id.includes('node_modules/xlsx')) return 'vendor-xlsx'
        },
      },
    },
    chunkSizeWarningLimit: 300,
  },
})
