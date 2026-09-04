import { useState, useMemo } from 'react'
import { Helmet } from 'react-helmet-async'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AlertDialog } from '@/components/ui/alert-dialog'
import {
  useCalendarEntries,
  useCreateCalendarEntry,
  useUpdateCalendarEntry,
  useDeleteCalendarEntry,
} from '@/hooks/useCalendar'
import { AddHolidayModal } from '@/components/AddHolidayModal'
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
  const [quickType, setQuickType] = useState<'holiday' | 'event'>('holiday')
  const [quickDate, setQuickDate] = useState('')
  const [quickTitle, setQuickTitle] = useState('')

  const startDate = `${year}-01-01`
  const endDate = `${year}-12-31`

  const { data: entries, isLoading } = useCalendarEntries(startDate, endDate)
  const createMutation = useCreateCalendarEntry()
  const updateMutation = useUpdateCalendarEntry()
  const deleteMutation = useDeleteCalendarEntry()

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
    setQuickType(dayType)
    setQuickDate('')
    setQuickTitle('')
    setOpen(true)
  }

  const openEdit = (e: SchoolCalendarEntry) => {
    setEditing(e)
    setQuickType(e.day_type as 'holiday' | 'event')
    setQuickDate(e.calendar_date)
    setQuickTitle(e.title ?? '')
    setOpen(true)
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync(deleteTarget.id)
      toast.success('Entry deleted')
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const quickAdd = (dayType: 'holiday' | 'event', date: Date, title: string) => {
    setEditing(null)
    setQuickType(dayType)
    setQuickDate(format(date, 'yyyy-MM-dd'))
    setQuickTitle(title)
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
                const d = new Date()
                const dow = d.getDay()
                const daysUntilFriday = (5 - dow + 7) % 7
                const offset = daysUntilFriday === 0 ? 7 : daysUntilFriday
                d.setDate(d.getDate() + offset)
                quickAdd('holiday', d, 'Mid-Term Break')
              }}
            >
              <Umbrella className="mr-2 h-4 w-4 text-yellow-600" />Mid-Term Break (Holiday)
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => {
                const d = new Date()
                const candidate = new Date(d.getFullYear(), 11, 15)
                if (candidate < d) candidate.setFullYear(d.getFullYear() + 1)
                quickAdd('event', candidate, 'School Closing Day')
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

      <AddHolidayModal
        key={editing?.id ?? `create-${quickDate}-${quickType}`}
        open={open}
        onOpenChange={setOpen}
        defaultType={quickType}
        defaultDate={quickDate}
        defaultTitle={quickTitle}
        editMode={!!editing}
        onSubmit={editing
          ? async (data) => {
              try {
                await updateMutation.mutateAsync({
                  id: editing.id,
                  input: { calendar_date: data.calendar_date, day_type: data.day_type, title: data.title, description: data.description },
                })
                toast.success('Entry updated')
              } catch (err) {
                toast.error(err instanceof Error ? err.message : String(err))
                throw err
              }
            }
          : async (data) => {
              try {
                await createMutation.mutateAsync({
                  calendar_date: data.calendar_date,
                  day_type: data.day_type,
                  title: data.title,
                  description: data.description,
                })
                toast.success(data.day_type === 'holiday' ? 'Holiday created' : 'Event created')
              } catch (err) {
                toast.error(err instanceof Error ? err.message : String(err))
                throw err
              }
            }
        }
      />

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
