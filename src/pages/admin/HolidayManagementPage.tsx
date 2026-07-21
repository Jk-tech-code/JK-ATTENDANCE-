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
import { Plus, Pencil, Trash2, Calendar } from 'lucide-react'
import { toast } from 'sonner'
import { format } from 'date-fns'

const currentYear = new Date().getFullYear()
const years = Array.from({ length: 5 }, (_, i) => currentYear - 1 + i)

export default function HolidayManagementPage() {
  const [year, setYear] = useState(currentYear)
  const [editing, setEditing] = useState<SchoolCalendarEntry | null>(null)
  const [open, setOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<SchoolCalendarEntry | null>(null)
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

  const openCreate = () => {
    setEditing(null)
    setForm({ calendar_date: '', day_type: 'holiday', title: '', description: '' })
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
        toast.success('Entry created')
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
          <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />Add Holiday/Event</Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-lg">Holidays & Events</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-center text-muted-foreground py-8">Loading...</p>
            ) : holidays.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No holidays or events for {year}</p>
            ) : (
              <div className="space-y-2">
                {holidays.sort((a, b) => a.calendar_date.localeCompare(b.calendar_date)).map(e => (
                  <div key={e.id} className="flex items-center justify-between rounded-lg border p-3 hover:bg-accent/50">
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
                        e.day_type === 'holiday' ? 'bg-yellow-100 text-yellow-700' : 'bg-purple-100 text-purple-700'
                      }`}>
                        <Calendar className="h-4 w-4" />
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
                setEditing(null)
                setForm({ calendar_date: format(nextWeek, 'yyyy-MM-dd'), day_type: 'holiday', title: 'Mid-Term Break', description: '' })
                setOpen(true)
              }}
            >
              <Calendar className="mr-2 h-4 w-4" />Mid-Term Break
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => {
                const endYear = new Date()
                endYear.setMonth(11, 1)
                setEditing(null)
                setForm({ calendar_date: format(endYear, 'yyyy-MM-dd'), day_type: 'event', title: 'School Closing Day', description: '' })
                setOpen(true)
              }}
            >
              <Calendar className="mr-2 h-4 w-4" />School Closing Day
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => {
                setEditing(null)
                setForm({ calendar_date: '', day_type: 'holiday', title: 'National Holiday', description: '' })
                setOpen(true)
              }}
            >
              <Calendar className="mr-2 h-4 w-4" />National Holiday
            </Button>
          </CardContent>
        </Card>
      </div>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setFormErrors({}) }} title={editing ? 'Edit Entry' : 'Add Holiday/Event'}>
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
            <Input value={form.title} onChange={e => { setForm({ ...form, title: e.target.value }); setFormErrors({ ...formErrors, title: '' })}} placeholder="e.g., National Holiday" className={formErrors.title ? 'border-destructive' : ''} />
            {formErrors.title && <p className="text-xs text-destructive">{formErrors.title}</p>}
          </div>
          <div className="space-y-2">
            <Label>Description (optional)</Label>
            <textarea className="flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Optional description" />
          </div>
          <Button onClick={handleSave} className="w-full" loading={saving} disabled={Object.keys(formErrors).length > 0}>
            {editing ? 'Update' : 'Create'} Entry
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
