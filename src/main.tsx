import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from 'react-error-boundary'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HelmetProvider } from 'react-helmet-async'
import { AuthProvider } from '@/contexts/AuthProvider'
import { NotificationProvider } from '@/contexts/NotificationContext'
import { RealtimeProvider } from '@/contexts/RealtimeContext'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { Fallback } from '@/components/Fallback'
import { PageLoader } from '@/components/PageLoader'
import { initSentry } from '@/lib/sentry'
import App from './App.tsx'
import './index.css'

initSentry()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary FallbackComponent={Fallback}>
      <HelmetProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <NotificationProvider>
            <RealtimeProvider>
            <ThemeProvider>
              <Suspense fallback={<PageLoader />}>
                <App />
              </Suspense>
            </ThemeProvider>
            </RealtimeProvider>
            </NotificationProvider>
          </AuthProvider>
        </QueryClientProvider>
      </HelmetProvider>
    </ErrorBoundary>
  </StrictMode>,
)
