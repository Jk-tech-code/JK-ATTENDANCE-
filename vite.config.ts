import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import sitemap from 'vite-plugin-sitemap'
import path from 'path'

const requiredEnvVars = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.warn(`Warning: ${envVar} is not set. Build will proceed but app may not work at runtime.`)
  }
}

const siteUrl = process.env.VITE_SITE_URL ?? 'https://jkattendance.vercel.app'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png'],
      manifest: {
        name: 'JK Attendance System',
        short_name: 'JK Attendance',
        description: 'GPS-based attendance tracking for Glorious Group of Schools',
        theme_color: '#0f172a',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'favicon.png', sizes: '32x32', type: 'image/png' },
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
      hostname: siteUrl,
      readable: true,
      dynamicRoutes: [
        '/',
        '/login',
        '/help',
      ],
      exclude: [
        '/admin/*',
        '/dashboard',
        '/reset-password',
        '/forgot-password',
      ],
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
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) return 'vendor-react'
          if (id.includes('node_modules/react-router')) return 'vendor-router'
          if (id.includes('node_modules/lucide-react') || id.includes('node_modules/sonner') || id.includes('node_modules/class-variance-authority')) return 'vendor-ui'
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
