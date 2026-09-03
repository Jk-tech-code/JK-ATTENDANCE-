import type { FallbackProps } from 'react-error-boundary'
import { Helmet } from 'react-helmet-async'
import { Button } from '@/components/ui/button'

export function Fallback({ resetErrorBoundary }: FallbackProps) {
  return (
    <>
      <Helmet>
        <title>Something went wrong — JK Attendance</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4 text-center" role="alert">
        <h1 className="text-2xl font-bold">Something went wrong</h1>
        <p className="text-muted-foreground">An unexpected error occurred. Please try again.</p>
        <Button onClick={resetErrorBoundary}>Try again</Button>
      </div>
    </>
  )
}
