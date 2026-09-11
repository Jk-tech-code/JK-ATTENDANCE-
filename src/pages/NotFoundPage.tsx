import { Helmet } from 'react-helmet-async'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Home, ArrowLeft } from 'lucide-react'

export default function NotFoundPage() {
  return (
    <>
      <Helmet>
        <title>404 — Page Not Found | JK Attendance</title>
        <meta name="description" content="The page you are looking for does not exist." />
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:shadow-lg"
        >
          Skip to main content
        </a>
        <main id="main-content">
          <Card className="w-full max-w-md">
            <CardContent className="pt-6 text-center space-y-6">
              <div>
                <p className="text-6xl font-bold text-muted-foreground/30">404</p>
                <h1 className="mt-2 text-xl font-semibold">Page Not Found</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  The page you are looking for doesn't exist or has been moved.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
                <Button variant="default" asChild>
                  <Link to="/login">
                    <Home className="mr-1 h-4 w-4" aria-hidden="true" />
                    Go to Login
                  </Link>
                </Button>
                <Button variant="outline" onClick={() => window.history.back()}>
                  <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
                  Go Back
                </Button>
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    </>
  )
}
