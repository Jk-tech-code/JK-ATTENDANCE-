import { ErrorBoundary, type FallbackProps } from 'react-error-boundary'
import { Button } from '@/components/ui/button'
import type { ReactNode } from 'react'

function DefaultFallback({ resetErrorBoundary }: FallbackProps) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-4 text-center" role="alert">
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="text-muted-foreground">An unexpected error occurred. Please try again.</p>
      <Button onClick={resetErrorBoundary}>Try again</Button>
    </div>
  )
}

DefaultFallback.displayName = 'DefaultFallback'

export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  return <ErrorBoundary FallbackComponent={DefaultFallback}>{children}</ErrorBoundary>
}
