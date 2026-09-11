import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Helmet } from 'react-helmet-async'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Dialog } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { useAdminUsers, useCreateAdmin } from '@/hooks/useAdmins'
import type { AdminUser } from '@/services/admin/admins'
import { useAuth } from '@/hooks/useAuth'
import { Plus, Shield, ShieldCheck, Users } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'

const adminSchema = z.object({
  full_name: z.string().min(1, 'Full name is required').max(200, 'Name too long'),
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Please enter a valid email address')
    .max(254),
  role: z.enum(['admin', 'superadmin']),
})

type AdminFormData = z.infer<typeof adminSchema>

export default function AdminManagementPage() {
  const { user } = useAuth()
  const isSuperadmin = user?.role === 'superadmin'

  const { data: admins, isLoading } = useAdminUsers()
  const createAdminMutation = useCreateAdmin()

  const [showCreateDialog, setShowCreateDialog] = useState(false)

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isValid },
  } = useForm<AdminFormData>({
    resolver: zodResolver(adminSchema),
    mode: 'onChange',
    defaultValues: {
      full_name: '',
      email: '',
      role: 'admin',
    },
  })

  const selectedRole = watch('role')

  const onFormSubmit = async (data: AdminFormData) => {
    const trimmed = {
      ...data,
      full_name: data.full_name.trim(),
      email: data.email.trim().toLowerCase(),
    }

    try {
      const result = await createAdminMutation.mutateAsync(trimmed)
      const tempPassword = result.admin.temp_password
      toast.success('Administrator account created', {
        description: tempPassword
          ? `Account created for ${trimmed.email}. Temporary password: ${tempPassword}\n\nShare this password securely. The admin can change it after logging in.`
          : `Account created for ${trimmed.email}. A password reset email has been sent.`,
        duration: 30000,
      })
      reset()
      setShowCreateDialog(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <>
      <Helmet>
        <title>Admin Management — JK Attendance</title>
      </Helmet>

      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Admin Management</h1>
            <p className="text-sm text-muted-foreground">
              Manage administrator and superadministrator accounts.
            </p>
          </div>
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Administrator
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Administrators
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : !admins || admins.length === 0 ? (
              <EmptyState
                title="No administrators"
                description="Add an administrator to get started."
                icon={<Shield className="h-12 w-12" />}
                action={{ label: 'Add Administrator', onClick: () => setShowCreateDialog(true) }}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th scope="col" className="pb-2 font-medium">
                        Name
                      </th>
                      <th scope="col" className="pb-2 font-medium">
                        Email
                      </th>
                      <th scope="col" className="pb-2 font-medium">
                        Role
                      </th>
                      <th scope="col" className="pb-2 font-medium">
                        Status
                      </th>
                      <th scope="col" className="pb-2 font-medium">
                        Created
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {admins.map((admin: AdminUser) => (
                      <tr key={admin.id} className="border-b last:border-0 hover:bg-muted/50">
                        <td className="py-3 font-medium">{admin.full_name}</td>
                        <td className="py-3 text-muted-foreground">{admin.email}</td>
                        <td className="py-3">
                          <Badge
                            variant={admin.role === 'superadmin' ? 'default' : 'secondary'}
                            className="gap-1"
                          >
                            {admin.role === 'superadmin' ? (
                              <ShieldCheck className="h-3 w-3" />
                            ) : (
                              <Shield className="h-3 w-3" />
                            )}
                            {admin.role === 'superadmin' ? 'Superadmin' : 'Admin'}
                          </Badge>
                        </td>
                        <td className="py-3">
                          <Badge variant={admin.invitation_sent ? 'success' : 'outline'}>
                            {admin.invitation_sent ? 'Invited' : 'Pending'}
                          </Badge>
                        </td>
                        <td className="py-3 text-muted-foreground">
                          {new Date(admin.created_at).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="rounded-md bg-muted/50 p-4 text-sm text-muted-foreground">
          <p>
            <strong>Admins</strong> can manage attendance, teachers, and administrative functions.
          </p>
          <p>
            <strong>Superadmins</strong> have full administrative privileges including the ability
            to manage other administrator accounts.
          </p>
        </div>
      </div>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog} title="Add Administrator">
        <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="full_name">Full Name</Label>
            <Input
              id="full_name"
              placeholder="Enter full name"
              {...register('full_name')}
              aria-invalid={!!errors.full_name}
            />
            {errors.full_name && (
              <p className="text-xs text-destructive">{errors.full_name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="admin@school.com"
              {...register('email')}
              aria-invalid={!!errors.email}
            />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="role">Role</Label>
            <Select
              id="role"
              {...register('role')}
              options={
                isSuperadmin
                  ? [
                      { value: 'admin', label: 'Admin' },
                      { value: 'superadmin', label: 'Superadmin' },
                    ]
                  : [{ value: 'admin', label: 'Admin' }]
              }
              disabled={!isSuperadmin}
            />
            {isSuperadmin && selectedRole === 'superadmin' && (
              <p className="text-xs text-amber-600">
                Superadmins have full control over the system including managing other
                administrators.
              </p>
            )}
          </div>

          <Button
            type="submit"
            className="w-full"
            loading={createAdminMutation.isPending}
            disabled={!isValid || createAdminMutation.isPending}
          >
            Create Administrator Account
          </Button>
        </form>
      </Dialog>
    </>
  )
}
