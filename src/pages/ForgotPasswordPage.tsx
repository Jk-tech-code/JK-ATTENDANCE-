import { Helmet } from 'react-helmet-async'
import { AuthLayout } from '@/layouts/AuthLayout'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Link } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'

export default function ForgotPasswordPage() {
  return (
    <>
      <Helmet>
        <title>Forgot Password — JK Attendance System</title>
        <meta name="description" content="Reset your JK Attendance System password" />
        <meta name="robots" content="noindex, follow" />
      </Helmet>
      <AuthLayout
        title="Reset password"
        subtitle="Contact your administrator to reset your password"
      >
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-4 text-center">
              <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">
                Email-based password reset is not currently available. Please contact your school
                administrator to have a new temporary password generated for your account.
              </p>
              <Button variant="outline" className="w-full" asChild>
                <Link to="/login">Back to login</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </AuthLayout>
    </>
  )
}
