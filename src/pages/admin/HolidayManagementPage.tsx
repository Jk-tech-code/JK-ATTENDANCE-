import { useState, useMemo } from 'react'
import { Helmet } from 'react-helmet-async'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog } from '@/components/ui/dialog'
import { AlertDialog } from '@/components/ui/alert-dialog'
import {
  useCalendarEntries,
  useCreateCalendarEntry,
  useUpdateCalendarEntry,
  useDeleteCalendarEntry,
} from '@/hooks/useCalendar'
import type { SchoolCalendarEntry } from '@/services/calendar'
import { Pencil, Trash2, Umbrella, Star } from 'lucide-react'
import { toast } from 'sonner'
import { format } from 'date-fns'

const currentYear = new Date().getFullYear()
const years = Array.from({ length: 5 }, (_, i) => currentYear - 1 + i)

export default function HolidayManagementPage() {
  const [year, setYear] = useState(currentYear)
  const [editing, setEditing] = useState<SchoolCalendarEntry | null>(null)
  const [open, setOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<SchoolCalendarEntry | null>(null)
  const [filter, setFilter] = useState<'all' | 'holiday' | 'event'>('all')
  const [form, setForm] = useState({
    calendar_date: '',
    day_type: 'holiday' as 'holiday' | 'event',
    title: '',
    description: '',
  })
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  const startDate = `${year}-01-01`
  const endDate = `${year}-12-31`

  const { data: entries, isLoading } = useCalendarEntries(startDate, endDate)
  const createMutation = useCreateCalendarEntry()
  const updateMutation = useUpdateCalendarEntry()
  const deleteMutation = useDeleteCalendarEntry()

  const saving = createMutation.isPending || updateMutation.isPending
  const deleting = deleteMutation.isPending

  const holidays = useMemo(
    () => (entries ?? []).filter(e => e.day_type === 'holiday' || e.day_type === 'event'),
    [entries],
  )

  const filtered = useMemo(() => {
    if (filter === 'all') return holidays
    return holidays.filter(e => e.day_type === filter)
  }, [holidays, filter])

  const openCreate = (dayType: 'holiday' | 'event') => {
    setEditing(null)
    setForm({ calendar_date: '', day_type: dayType, title: '', description: '' })
    setFormErrors({})
    setOpen(true)
  }

  const openEdit = (e: SchoolCalendarEntry) => {
    setEditing(e)
    setForm({
      calendar_date: e.calendar_date,
      day_type: e.day_type as 'holiday' | 'event',
      title: e.title ?? '',
      description: e.description ?? '',
    })
    setFormErrors({})
    setOpen(true)
  }

  const handleSave = async () => {
    const errors: Record<string, string> = {}
    if (!form.calendar_date) errors.calendar_date = 'Date is required'
    if (!form.title.trim()) errors.title = 'Title is required'
    setFormErrors(errors)
    if (Object.keys(errors).length > 0) return

    try {
      if (editing) {
        await updateMutation.mutateAsync({
          id: editing.id,
          input: { calendar_date: form.calendar_date, day_type: form.day_type, title: form.title.trim(), description: form.description },
        })
        toast.success('Entry updated')
      } else {
        await createMutation.mutateAsync({ ...form, title: form.title.trim() })
        toast.success(form.day_type === 'holiday' ? 'Holiday created' : 'Event created')
      }
      setOpen(false)
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync(deleteTarget.id)
      toast.success('Entry deleted')
      setDeleteTarget(null)
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const quickAdd = (dayType: 'holiday' | 'event', date: Date, title: string) => {
    setEditing(null)
    setForm({ calendar_date: format(date, 'yyyy-MM-dd'), day_type: dayType, title, description: '' })
    setFormErrors({})
    setOpen(true)
  }

  return (
    <>
      <Helmet>
        <title>Holidays — Admin | JK Attendance System</title>
        <meta name="description" content="Manage school holidays and events" />
        <meta name="robots" content="noindex, follow" />
      </Helmet>
      <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Holidays & Events</h1>
        <div className="flex items-center gap-2">
          <select className="h-9 rounded-md border px-3 text-sm" value={year} onChange={e => setYear(Number(e.target.value))}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <Button onClick={() => openCreate('holiday')}><Umbrella className="mr-2 h-4 w-4" />Add Holiday</Button>
          <Button variant="outline" onClick={() => openCreate('event')}><Star className="mr-2 h-4 w-4" />Add Event</Button>
        </div>
      </div>

      <div className="flex gap-2">
        {(['all', 'holiday', 'event'] as const).map(f => (
          <Button key={f} variant={filter === f ? 'default' : 'outline'} size="sm" onClick={() => setFilter(f)} className="capitalize">
            {f === 'all' ? 'All' : f === 'holiday' ? <><Umbrella className="mr-1 h-3.5 w-3.5" />Holidays</> : <><Star className="mr-1 h-3.5 w-3.5" />Events</>}
          </Button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-lg">{filter === 'all' ? 'All Entries' : filter === 'holiday' ? 'Holidays' : 'Events'}</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-center text-muted-foreground py-8">Loading...</p>
            ) : filtered.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No {filter === 'all' ? 'holidays or events' : filter + 's'} for {year}</p>
            ) : (
              <div className="space-y-2">
                {filtered.sort((a, b) => a.calendar_date.localeCompare(b.calendar_date)).map(e => (
                  <div key={e.id} className="flex items-center justify-between rounded-lg border p-3 hover:bg-accent/50">
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
                        e.day_type === 'holiday' ? 'bg-yellow-100 text-yellow-700' : 'bg-purple-100 text-purple-700'
                      }`}>
                        {e.day_type === 'holiday' ? <Umbrella className="h-4 w-4" /> : <Star className="h-4 w-4" />}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{e.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(e.calendar_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                        </p>
                        {e.description && <p className="text-xs text-muted-foreground mt-0.5">{e.description}</p>}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(e)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(e)}><Trash2 className="h-3.5 w-3.5 text-red-500" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-lg">Quick Add</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => {
                const nextWeek = new Date()
                nextWeek.setDate(nextWeek.getDate() + (11 - nextWeek.getDay()) % 7 + 1)
                quickAdd('holiday', nextWeek, 'Mid-Term Break')
              }}
            >
              <Umbrella className="mr-2 h-4 w-4 text-yellow-600" />Mid-Term Break (Holiday)
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => {
                const endYear = new Date()
                endYear.setMonth(11, 1)
                quickAdd('event', endYear, 'School Closing Day')
              }}
            >
              <Star className="mr-2 h-4 w-4 text-purple-600" />School Closing Day (Event)
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => {
                const d = new Date()
                quickAdd('holiday', d, 'National Holiday')
              }}
            >
              <Umbrella className="mr-2 h-4 w-4 text-yellow-600" />National Holiday
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => {
                const d = new Date()
                quickAdd('event', d, 'School Event')
              }}
            >
              <Star className="mr-2 h-4 w-4 text-purple-600" />Custom Event
            </Button>
          </CardContent>
        </Card>
      </div>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setFormErrors({}) }} title={editing ? 'Edit Entry' : form.day_type === 'holiday' ? 'Add Holiday' : 'Add Event'}>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Date <span className="text-destructive">*</span></Label>
            <Input type="date" value={form.calendar_date} onChange={e => { setForm({ ...form, calendar_date: e.target.value }); setFormErrors({ ...formErrors, calendar_date: '' })}} className={formErrors.calendar_date ? 'border-destructive' : ''} />
            {formErrors.calendar_date && <p className="text-xs text-destructive">{formErrors.calendar_date}</p>}
          </div>
          <div className="space-y-2">
            <Label>Type</Label>
            <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.day_type} onChange={e => setForm({ ...form, day_type: e.target.value as 'holiday' | 'event' })}>
              <option value="holiday">Holiday</option>
              <option value="event">Event</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label>Title <span className="text-destructive">*</span></Label>
            <Input value={form.title} onChange={e => { setForm({ ...form, title: e.target.value }); setFormErrors({ ...formErrors, title: '' })}} placeholder={form.day_type === 'holiday' ? 'e.g., National Holiday' : 'e.g., Sports Day'} className={formErrors.title ? 'border-destructive' : ''} />
            {formErrors.title && <p className="text-xs text-destructive">{formErrors.title}</p>}
          </div>
          <div className="space-y-2">
            <Label>Description (optional)</Label>
            <textarea className="flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Optional description" />
          </div>
          <Button onClick={handleSave} className="w-full" loading={saving} disabled={Object.keys(formErrors).length > 0}>
            {editing ? 'Update' : 'Create'} {form.day_type === 'holiday' ? 'Holiday' : 'Event'}
          </Button>
        </div>
      </Dialog>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={o => { if (!o) setDeleteTarget(null) }}
        title="Delete Entry"
        description={`Are you sure you want to delete "${deleteTarget?.title}" on ${deleteTarget?.calendar_date}?`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
        loading={deleting}
      />
    </div>
    </>
  )
}
