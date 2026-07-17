import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Helmet } from 'react-helmet-async'
import { resetPassword } from '@/services/auth'
import { AuthLayout } from '@/layouts/AuthLayout'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Link } from 'react-router-dom'
import { Loader2, CheckCircle2 } from 'lucide-react'

const forgotSchema = z.object({
  email: z.string().email('Enter a valid email address'),
})

type ForgotForm = z.infer<typeof forgotSchema>

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotForm>({
    resolver: zodResolver(forgotSchema),
  })

  const onSubmit = async (data: ForgotForm) => {
    setError(null)
    const result = await resetPassword(data.email)
    if (result.error) {
      setError(result.error)
      return
    }
    setSent(true)
  }

  return (
    <>
      <Helmet>
        <title>Forgot Password — JK Attendance System</title>
        <meta name="description" content="Reset your JK Attendance System password" />
        <meta name="robots" content="noindex, follow" />
      </Helmet>
      <AuthLayout
        title="Reset password"
        subtitle="Enter your email and we'll send you a reset link"
      >
      <Card>
        <CardContent className="pt-6">
          {sent ? (
            <div className="space-y-4 text-center">
              <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
              <p className="text-sm text-muted-foreground">
                Check your email for the reset link.
              </p>
              <Button variant="outline" className="w-full" asChild>
                <Link to="/login">Back to login</Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@school.com"
                  {...register('email')}
                />
                {errors.email && (
                  <p className="text-xs text-destructive">{errors.email.message}</p>
                )}
              </div>

              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending...</>
                ) : (
                  'Send reset link'
                )}
              </Button>

              <p className="text-center text-xs text-muted-foreground">
                Remember your password?{' '}
                <Link to="/login" className="underline-offset-4 hover:underline">
                  Sign in
                </Link>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </AuthLayout>
    </>
  )
}
