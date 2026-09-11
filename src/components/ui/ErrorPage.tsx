import { ErrorBoundary, type FallbackProps } from 'react-error-boundary'
import * as Sentry from '@sentry/react'
import { Helmet } from 'react-helmet-async'
import { Button } from '@/components/ui/button'
import type { ReactNode } from 'react'

function DefaultFallback({ error, resetErrorBoundary }: FallbackProps) {
  if (error) {
    Sentry.captureException(error)
    console.error('[RouteErrorBoundary] captured error:', error)
  }

  const isDev = import.meta.env.DEV

  return (
    <>
      <Helmet>
        <title>Something went wrong — JK Attendance</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <div
        className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-4 text-center"
        role="alert"
      >
        <h1 className="text-2xl font-bold">Something went wrong</h1>
        <p className="text-muted-foreground">An unexpected error occurred. Please try again.</p>
        {isDev && error instanceof Error && (
          <pre className="max-w-2xl overflow-auto rounded-md border bg-muted/40 p-3 text-left text-xs text-muted-foreground" tabIndex={0} role="region" aria-label="Error details">
            {error.message}
          </pre>
        )}
        <Button onClick={resetErrorBoundary}>Try again</Button>
      </div>
    </>
  )
}

DefaultFallback.displayName = 'DefaultFallback'

export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  return <ErrorBoundary FallbackComponent={DefaultFallback}>{children}</ErrorBoundary>
}
