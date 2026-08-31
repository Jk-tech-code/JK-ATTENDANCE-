import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

const inviteSchema = z.object({
  staff_number: z.string().min(1, 'Staff number is required').max(50, 'Staff number too long'),
  full_name: z.string().min(1, 'Full name is required').max(200, 'Name too long'),
  email: z.string().min(1, 'Email is required').email('Enter a valid email address').max(254),
  department: z.string().max(200).optional().or(z.literal('')),
  phone: z.string().max(30).optional().or(z.literal('')),
  reporting_time: z.string().optional().or(z.literal('')),
})

export type InviteTeacherFormData = z.infer<typeof inviteSchema>

interface InviteTeacherModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (data: InviteTeacherFormData) => Promise<void>
}

export function InviteTeacherModal({ open, onOpenChange, onSubmit }: InviteTeacherModalProps) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isValid },
  } = useForm<InviteTeacherFormData>({
    resolver: zodResolver(inviteSchema),
    mode: 'onChange',
    defaultValues: {
      staff_number: '',
      full_name: '',
      email: '',
      department: '',
      phone: '',
      reporting_time: '07:20',
    },
  })

  const handleClose = (o: boolean) => {
    if (!o && !isSubmitting) {
      reset()
      onOpenChange(false)
    }
  }

  const onFormSubmit = async (data: InviteTeacherFormData) => {
    const trimmed: InviteTeacherFormData = {
      staff_number: data.staff_number.trim(),
      full_name: data.full_name.trim(),
      email: data.email.trim(),
      department: data.department?.trim() || undefined,
      phone: data.phone?.trim() || undefined,
      reporting_time: data.reporting_time || undefined,
    }
    await onSubmit(trimmed)
    reset()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose} title="Invite Teacher">
      <p className="text-sm text-muted-foreground mb-4">
        An invitation email will be sent to the teacher with a secure link to create their password and activate their account.
      </p>
      <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="invite-staff-number">
              Staff Number <span className="text-destructive">*</span>
            </Label>
            <Input
              id="invite-staff-number"
              {...register('staff_number')}
              className={errors.staff_number ? 'border-destructive' : ''}
            />
            {errors.staff_number && (
              <p className="text-xs text-destructive">{errors.staff_number.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-full-name">
              Full Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="invite-full-name"
              {...register('full_name')}
              className={errors.full_name ? 'border-destructive' : ''}
            />
            {errors.full_name && (
              <p className="text-xs text-destructive">{errors.full_name.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-email">
              Email <span className="text-destructive">*</span>
            </Label>
            <Input
              id="invite-email"
              type="email"
              {...register('email')}
              className={errors.email ? 'border-destructive' : ''}
            />
            {errors.email && (
              <p className="text-xs text-destructive">{errors.email.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-department">Department</Label>
            <Input id="invite-department" {...register('department')} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-phone">Phone</Label>
            <Input
              id="invite-phone"
              {...register('phone')}
              className={errors.phone ? 'border-destructive' : ''}
            />
            {errors.phone && (
              <p className="text-xs text-destructive">{errors.phone.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-reporting-time">Reporting Time</Label>
            <Input id="invite-reporting-time" type="time" {...register('reporting_time')} />
          </div>
        </div>
        <Button type="submit" className="w-full" loading={isSubmitting} disabled={!isValid || isSubmitting}>
          Invite & Create Account
        </Button>
      </form>
    </Dialog>
  )
}