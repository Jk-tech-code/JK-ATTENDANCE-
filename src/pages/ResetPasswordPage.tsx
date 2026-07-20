import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Helmet } from 'react-helmet-async'
import { supabase } from '@/services/supabase'
import { AuthLayout } from '@/layouts/AuthLayout'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, CheckCircle2 } from 'lucide-react'

const resetSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
})

type ResetForm = z.infer<typeof resetSchema>

export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hashReady, setHashReady] = useState(false)

  useEffect(() => {
    const hash = window.location.hash
    if (hash && hash.includes('access_token')) {
      supabase.auth.setSession({
        access_token: new URLSearchParams(hash.replace('#', '')).get('access_token') ?? '',
        refresh_token: new URLSearchParams(hash.replace('#', '')).get('refresh_token') ?? '',
      }).then(() => setHashReady(true)).catch(() => setHashReady(true))
    } else {
      setHashReady(true)
    }
  }, [])

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetForm>({
    resolver: zodResolver(resetSchema),
  })

  const onSubmit = async (data: ResetForm) => {
    setError(null)
    const { error } = await supabase.auth.updateUser({ password: data.password })
    if (error) {
      setError(error.message)
      return
    }
    setDone(true)
    setTimeout(() => navigate('/login', { replace: true }), 3000)
  }

  if (!hashReady) {
    return (
      <AuthLayout title="Reset password" subtitle="Processing...">
        <Card><CardContent className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></CardContent></Card>
      </AuthLayout>
    )
  }

  return (
    <>
      <Helmet>
        <title>Create Password — JK Attendance System</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <AuthLayout title="Create your password" subtitle="Choose a password to activate your account">
        <Card>
          <CardContent className="pt-6">
            {done ? (
              <div className="space-y-4 text-center">
                <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
                <p className="text-sm text-muted-foreground">Password set. Redirecting to login...</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password">New Password</Label>
                  <Input id="password" type="password" placeholder="Min. 8 characters" {...register('password')} />
                  {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm Password</Label>
                  <Input id="confirmPassword" type="password" placeholder="Repeat password" {...register('confirmPassword')} />
                  {errors.confirmPassword && <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>}
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button type="submit" className="w-full" disabled={isSubmitting}>
                  {isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Setting...</> : 'Create password'}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
        <p className="text-center text-xs text-muted-foreground">
          This link was sent to your email. Need a new one? Contact your administrator.
        </p>
      </AuthLayout>
    </>
  )
}
