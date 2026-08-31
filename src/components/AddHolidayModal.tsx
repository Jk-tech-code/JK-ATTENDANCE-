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
    formState: { errors, isSubmitting, isValid },
  } = useForm<HolidayFormData>({
    resolver: zodResolver(holidaySchema),
    mode: 'onChange',
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

  return (
    <Dialog
      open={open}
      onOpenChange={handleClose}
      title={editMode ? 'Edit Entry' : dayType === 'holiday' ? 'Add Holiday' : 'Add Event'}
    >
      <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="ahm-date">
            Date <span className="text-destructive">*</span>
          </Label>
          <Input
            id="ahm-date"
            type="date"
            {...register('calendar_date')}
            className={errors.calendar_date ? 'border-destructive' : ''}
          />
          {errors.calendar_date && (
            <p className="text-xs text-destructive">{errors.calendar_date.message}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="ahm-type">Type</Label>
          <select
            id="ahm-type"
            {...register('day_type')}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="holiday">Holiday</option>
            <option value="event">Event</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="ahm-title">
            Title <span className="text-destructive">*</span>
          </Label>
          <Input
            id="ahm-title"
            {...register('title')}
            placeholder={dayType === 'holiday' ? 'e.g., National Holiday' : 'e.g., Sports Day'}
            className={errors.title ? 'border-destructive' : ''}
          />
          {errors.title && (
            <p className="text-xs text-destructive">{errors.title.message}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="ahm-description">Description (optional)</Label>
          <textarea
            id="ahm-description"
            {...register('description')}
            className="flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring placeholder:text-muted-foreground"
            placeholder="Optional description"
          />
        </div>
        <Button type="submit" className="w-full" loading={isSubmitting} disabled={!isValid || isSubmitting}>
          {editMode ? 'Update Entry' : dayType === 'holiday' ? 'Create Holiday' : 'Create Event'}
        </Button>
      </form>
    </Dialog>
  )
}