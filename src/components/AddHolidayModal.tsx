import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

const holidaySchema = z.object({
  calendar_date: z.string().min(1, 'Date is required'),
  day_type: z.enum(['holiday', 'event']),
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  description: z.string().max(500).optional().or(z.literal('')),
})

export type HolidayFormData = z.infer<typeof holidaySchema>

interface AddHolidayModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultType?: 'holiday' | 'event'
  defaultDate?: string
  defaultTitle?: string
  editMode?: boolean
  onSubmit: (data: HolidayFormData) => Promise<void>
}

export function AddHolidayModal({
  open,
  onOpenChange,
  defaultType = 'holiday',
  defaultDate = '',
  defaultTitle = '',
  editMode = false,
  onSubmit,
}: AddHolidayModalProps) {
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setError,
    formState: { errors, isSubmitting, submitCount },
  } = useForm<HolidayFormData>({
    resolver: zodResolver(holidaySchema),
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    defaultValues: {
      calendar_date: defaultDate,
      day_type: defaultType,
      title: defaultTitle,
      description: '',
    },
  })

  useEffect(() => {
    if (open) {
      reset({
        calendar_date: defaultDate,
        day_type: defaultType,
        title: defaultTitle,
        description: '',
      })
    }
  }, [open, defaultDate, defaultType, defaultTitle, reset])

  const dayType = watch('day_type')

  const handleClose = (o: boolean) => {
    if (!o && !isSubmitting) {
      reset()
      onOpenChange(false)
    }
  }

  const onFormSubmit = async (data: HolidayFormData) => {
    const trimmed: HolidayFormData = {
      calendar_date: data.calendar_date,
      day_type: data.day_type,
      title: data.title.trim(),
      description: data.description?.trim() || undefined,
    }
    await onSubmit(trimmed)
    reset()
    onOpenChange(false)
  }

  const onValidationError = (validationErrors: typeof errors) => {
    const firstError = Object.values(validationErrors)[0]
    const message = firstError?.message ?? 'Please fix the errors below'
    setError('root', { type: 'manual', message })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={handleClose}
      title={editMode ? 'Edit Entry' : dayType === 'holiday' ? 'Add Holiday' : 'Add Event'}
    >
      <form onSubmit={handleSubmit(onFormSubmit, onValidationError)} noValidate className="space-y-4">
        {errors.root && (
          <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {errors.root.message}
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="ahm-date">
            Date <span className="text-destructive">*</span>
          </Label>
          <Input
            id="ahm-date"
            type="date"
            aria-invalid={!!errors.calendar_date}
            aria-describedby={errors.calendar_date ? 'ahm-date-error' : undefined}
            {...register('calendar_date')}
            className={errors.calendar_date ? 'border-destructive' : ''}
          />
          {errors.calendar_date && (
            <p id="ahm-date-error" role="alert" className="text-xs text-destructive">{errors.calendar_date.message}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="ahm-type">Type</Label>
          <select
            id="ahm-type"
            aria-invalid={!!errors.day_type}
            {...register('day_type')}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="holiday">Holiday</option>
            <option value="event">Event</option>
            {editMode && (
              <>
                <option value="working_day">Working Day</option>
                <option value="weekend">Weekend</option>
              </>
            )}
          </select>
          {errors.day_type && (
            <p role="alert" className="text-xs text-destructive">{errors.day_type.message}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="ahm-title">
            Title <span className="text-destructive">*</span>
          </Label>
          <Input
            id="ahm-title"
            aria-invalid={!!errors.title}
            aria-describedby={errors.title ? 'ahm-title-error' : undefined}
            {...register('title')}
            placeholder={dayType === 'holiday' ? 'e.g., National Holiday' : 'e.g., Sports Day'}
            className={errors.title ? 'border-destructive' : ''}
          />
          {errors.title && (
            <p id="ahm-title-error" role="alert" className="text-xs text-destructive">{errors.title.message}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="ahm-description">Description (optional)</Label>
          <textarea
            id="ahm-description"
            aria-invalid={!!errors.description}
            aria-describedby={errors.description ? 'ahm-description-error' : undefined}
            {...register('description')}
            className="flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring placeholder:text-muted-foreground"
            placeholder="Optional description"
          />
          {errors.description && (
            <p id="ahm-description-error" role="alert" className="text-xs text-destructive">{errors.description.message}</p>
          )}
        </div>
        <Button
          type="submit"
          className="w-full"
          loading={isSubmitting}
          disabled={isSubmitting}
          data-testid="submit-holiday"
        >
          {editMode ? 'Update Entry' : dayType === 'holiday' ? 'Create Holiday' : 'Create Event'}
        </Button>
        {submitCount > 0 && Object.keys(errors).length > 0 && (
          <p role="status" className="text-center text-xs text-muted-foreground">
            Please correct the highlighted fields above.
          </p>
        )}
      </form>
    </Dialog>
  )
}