import { useState, useMemo, useRef } from 'react'
import { Helmet } from 'react-helmet-async'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog } from '@/components/ui/dialog'
import { AlertDialog } from '@/components/ui/alert-dialog'
import { useDebounce } from '@/hooks/useDebounce'
import { useTeachers, useCreateTeacher, useUpdateTeacher, useDeleteTeacher, useInviteTeacher } from '@/hooks/useTeachers'
import type { Teacher } from '@/types'
import { Plus, Pencil, Trash2, Search, UserPlus, Users } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { useVirtualizer } from '@tanstack/react-virtual'

const defaultForm = {
  staff_number: '',
  full_name: '',
  email: '',
  department: '',
  phone: '',
  reporting_time: '07:20',
  employment_status: 'active',
}

const defaultInviteForm = {
  staff_number: '',
  full_name: '',
  email: '',
  department: '',
  phone: '',
  reporting_time: '07:20',
}

function validateForm(values: Record<string, string>): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!values.staff_number.trim()) errors.staff_number = 'Staff number is required'
  if (!values.full_name.trim()) errors.full_name = 'Full name is required'
  if (!values.email.trim()) {
    errors.email = 'Email is required'
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
    errors.email = 'Invalid email format'
  }
  if (values.phone && !/^[+]?[\d\s()-]{6,20}$/.test(values.phone)) {
    errors.phone = 'Invalid phone number format'
  }
  return errors
}

export default function TeachersPage() {
  const { data: teachers, isLoading } = useTeachers()
  const createMutation = useCreateTeacher()
  const updateMutation = useUpdateTeacher()
  const deleteMutation = useDeleteTeacher()
  const inviteMutation = useInviteTeacher()

  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  const [editing, setEditing] = useState<Teacher | null>(null)
  const [open, setOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Teacher | null>(null)
  const [form, setForm] = useState(defaultForm)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [inviteForm, setInviteForm] = useState(defaultInviteForm)
  const [inviteFormErrors, setInviteFormErrors] = useState<Record<string, string>>({})

  const filtered = useMemo(() => {
    if (!teachers) return []
    if (!debouncedSearch.trim()) return teachers
    const q = debouncedSearch.toLowerCase()
    return teachers.filter(t =>
      t.full_name.toLowerCase().includes(q) ||
      t.staff_number.toLowerCase().includes(q) ||
      t.email.toLowerCase().includes(q) ||
      (t.department ?? '').toLowerCase().includes(q)
    )
  }, [teachers, debouncedSearch])

  const openCreate = () => {
    setEditing(null)
    setForm(defaultForm)
    setFormErrors({})
    setOpen(true)
  }

  const openEdit = (t: Teacher) => {
    setEditing(t)
    setForm({
      staff_number: t.staff_number,
      full_name: t.full_name,
      email: t.email,
      department: t.department ?? '',
      phone: t.phone ?? '',
      reporting_time: t.reporting_time ?? '07:20',
      employment_status: t.employment_status ?? 'active',
    })
    setFormErrors({})
    setOpen(true)
  }

  const handleSave = async () => {
    const errors = validateForm(form)
    setFormErrors(errors)
    if (Object.keys(errors).length > 0) return

    try {
      if (editing) {
        await updateMutation.mutateAsync({ id: editing.id, input: form })
        toast.success('Teacher updated successfully')
      } else {
        await createMutation.mutateAsync(form)
        toast.success('Teacher created and invitation sent', {
          description: `${form.email} will receive a link to create their password and sign in.`,
          duration: 10000,
        })
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
      toast.success('Teacher deleted successfully')
      setDeleteTarget(null)
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const handleInvite = async () => {
    const errors = validateForm(inviteForm)
    setInviteFormErrors(errors)
    if (Object.keys(errors).length > 0) return

    try {
      await inviteMutation.mutateAsync(inviteForm)
      setInviteOpen(false)
      toast.success('Invitation email sent', {
        description: `${inviteForm.email} will receive a link to create their password and sign in.`,
        duration: 10000,
      })
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const saving = createMutation.isPending || updateMutation.isPending
  const deleting = deleteMutation.isPending
  const inviting = inviteMutation.isPending

  return (
    <>
      <Helmet>
        <title>Teachers — Admin | JK Attendance System</title>
        <meta name="description" content="Manage teacher accounts and profiles" />
        <meta name="robots" content="noindex, follow" />
      </Helmet>
      <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Teachers</h1>
        <div className="flex gap-2">
          <Button onClick={() => { setInviteForm(defaultInviteForm); setInviteOpen(true) }}>
            <UserPlus className="mr-2 h-4 w-4" />Invite Teacher
          </Button>
          <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />Add Teacher</Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <CardTitle>All Teachers</CardTitle>
            <div className="relative ml-auto max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search teachers..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-8 h-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : !teachers || teachers.length === 0 ? (
            <EmptyState
              title="No teachers yet"
              description="Add your first teacher to get started."
              icon={<Users className="h-12 w-12" />}
              action={{ label: "Add Teacher", onClick: openCreate }}
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              title="No matching teachers"
              description="Try a different search term."
              icon={<Search className="h-12 w-12" />}
            />
          ) : (
            <div className="overflow-x-auto">
              <VirtualizedTeacherTable
                teachers={filtered}
                onEdit={openEdit}
                onDelete={(t) => setDeleteTarget(t)}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setFormErrors({}) }} title={editing ? 'Edit Teacher' : 'Add Teacher'}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Staff Number <span className="text-destructive">*</span></Label>
              <Input value={form.staff_number} onChange={e => { setForm({ ...form, staff_number: e.target.value }); setFormErrors({ ...formErrors, staff_number: '' })}} className={formErrors.staff_number ? 'border-destructive' : ''} />
              {formErrors.staff_number && <p className="text-xs text-destructive">{formErrors.staff_number}</p>}
            </div>
            <div className="space-y-2">
              <Label>Full Name <span className="text-destructive">*</span></Label>
              <Input value={form.full_name} onChange={e => { setForm({ ...form, full_name: e.target.value }); setFormErrors({ ...formErrors, full_name: '' })}} className={formErrors.full_name ? 'border-destructive' : ''} />
              {formErrors.full_name && <p className="text-xs text-destructive">{formErrors.full_name}</p>}
            </div>
            <div className="space-y-2">
              <Label>Email <span className="text-destructive">*</span></Label>
              <Input type="email" value={form.email} onChange={e => { setForm({ ...form, email: e.target.value }); setFormErrors({ ...formErrors, email: '' })}} disabled={!!editing} className={formErrors.email ? 'border-destructive' : ''} />
              {formErrors.email && <p className="text-xs text-destructive">{formErrors.email}</p>}
            </div>
            <div className="space-y-2">
              <Label>Department</Label>
              <Input value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={form.phone} onChange={e => { setForm({ ...form, phone: e.target.value }); setFormErrors({ ...formErrors, phone: '' })}} className={formErrors.phone ? 'border-destructive' : ''} />
              {formErrors.phone && <p className="text-xs text-destructive">{formErrors.phone}</p>}
            </div>
            <div className="space-y-2">
              <Label>Reporting Time</Label>
              <Input type="time" value={form.reporting_time} onChange={e => setForm({ ...form, reporting_time: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                value={form.employment_status}
                onChange={e => setForm({ ...form, employment_status: e.target.value })}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="suspended">Suspended</option>
              </select>
            </div>
          </div>
          <Button onClick={handleSave} className="w-full" loading={saving} disabled={Object.keys(formErrors).length > 0}>
            {editing ? 'Update' : 'Create'} Teacher
          </Button>
        </div>
      </Dialog>

      <Dialog open={inviteOpen} onOpenChange={(o) => { setInviteOpen(o); if (!o) setInviteFormErrors({}) }} title="Invite Teacher">
        <p className="text-sm text-muted-foreground mb-4">
          An invitation email will be sent to the teacher with a secure link to create their password and activate their account.
        </p>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Staff Number <span className="text-destructive">*</span></Label>
              <Input value={inviteForm.staff_number} onChange={e => { setInviteForm({ ...inviteForm, staff_number: e.target.value }); setInviteFormErrors({ ...inviteFormErrors, staff_number: '' })}} className={inviteFormErrors.staff_number ? 'border-destructive' : ''} />
              {inviteFormErrors.staff_number && <p className="text-xs text-destructive">{inviteFormErrors.staff_number}</p>}
            </div>
            <div className="space-y-2">
              <Label>Full Name <span className="text-destructive">*</span></Label>
              <Input value={inviteForm.full_name} onChange={e => { setInviteForm({ ...inviteForm, full_name: e.target.value }); setInviteFormErrors({ ...inviteFormErrors, full_name: '' })}} className={inviteFormErrors.full_name ? 'border-destructive' : ''} />
              {inviteFormErrors.full_name && <p className="text-xs text-destructive">{inviteFormErrors.full_name}</p>}
            </div>
            <div className="space-y-2">
              <Label>Email <span className="text-destructive">*</span></Label>
              <Input type="email" value={inviteForm.email} onChange={e => { setInviteForm({ ...inviteForm, email: e.target.value }); setInviteFormErrors({ ...inviteFormErrors, email: '' })}} className={inviteFormErrors.email ? 'border-destructive' : ''} />
              {inviteFormErrors.email && <p className="text-xs text-destructive">{inviteFormErrors.email}</p>}
            </div>
            <div className="space-y-2">
              <Label>Department</Label>
              <Input value={inviteForm.department} onChange={e => setInviteForm({ ...inviteForm, department: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={inviteForm.phone} onChange={e => { setInviteForm({ ...inviteForm, phone: e.target.value }); setInviteFormErrors({ ...inviteFormErrors, phone: '' })}} className={inviteFormErrors.phone ? 'border-destructive' : ''} />
              {inviteFormErrors.phone && <p className="text-xs text-destructive">{inviteFormErrors.phone}</p>}
            </div>
            <div className="space-y-2">
              <Label>Reporting Time</Label>
              <Input type="time" value={inviteForm.reporting_time} onChange={e => setInviteForm({ ...inviteForm, reporting_time: e.target.value })} />
            </div>
          </div>
          <Button onClick={handleInvite} className="w-full" loading={inviting} disabled={Object.keys(inviteFormErrors).length > 0}>
            Invite & Create Account
          </Button>
        </div>
      </Dialog>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}
        title="Delete Teacher"
        description={`Are you sure you want to delete ${deleteTarget?.full_name}? This will permanently remove their record and all associated attendance data.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
        loading={deleting}
      />
    </div>
    </>
  )
}

function VirtualizedTeacherTable({ teachers, onEdit, onDelete }: {
  teachers: Teacher[]
  onEdit: (t: Teacher) => void
  onDelete: (t: Teacher) => void
}) {
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: teachers.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 45,
    overscan: 10,
  })

  const columnWidths = ['flex-[1.2]', 'flex-[2]', 'flex-[2]', 'flex-[1.5]', 'flex-[1.2]', 'flex-[0.9]', 'flex-[1]', 'w-24 shrink-0']

  return (
    <div>
      <div className="flex items-center border-b pb-2 text-left text-xs font-medium text-muted-foreground">
        <div className={`${columnWidths[0]} px-2`}>Staff No.</div>
        <div className={`${columnWidths[1]} px-2`}>Name</div>
        <div className={`${columnWidths[2]} px-2`}>Email</div>
        <div className={`${columnWidths[3]} px-2`}>Department</div>
        <div className={`${columnWidths[4]} px-2`}>Phone</div>
        <div className={`${columnWidths[5]} px-2`}>Reporting</div>
        <div className={`${columnWidths[6]} px-2`}>Status</div>
        <div className={`${columnWidths[7]} px-2`}>Actions</div>
      </div>
      <div
        ref={parentRef}
        className="w-full"
        style={{
          height: Math.min(teachers.length * 45, 600),
          overflow: 'auto',
        }}
      >
        <div style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const t = teachers[virtualItem.index]
            return (
              <div
                key={t.id}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: virtualItem.size,
                  transform: `translateY(${virtualItem.start}px)`,
                }}
                className="flex items-center border-b text-sm hover:bg-muted/50"
              >
                <div className={`${columnWidths[0]} min-w-0 px-2 py-2 truncate`}>{t.staff_number}</div>
                <div className={`${columnWidths[1]} min-w-0 px-2 py-2 truncate font-medium`}>{t.full_name}</div>
                <div className={`${columnWidths[2]} min-w-0 px-2 py-2 truncate text-muted-foreground`}>{t.email}</div>
                <div className={`${columnWidths[3]} min-w-0 px-2 py-2 truncate text-muted-foreground`}>{t.department ?? '-'}</div>
                <div className={`${columnWidths[4]} min-w-0 px-2 py-2 truncate text-muted-foreground`}>{t.phone ?? '-'}</div>
                <div className={`${columnWidths[5]} min-w-0 px-2 py-2 truncate`}>{t.reporting_time ?? '07:20'}</div>
                <div className={`${columnWidths[6]} min-w-0 px-2 py-2`}>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    t.employment_status === 'active' ? 'bg-green-100 text-green-700' :
                    t.employment_status === 'inactive' ? 'bg-gray-100 text-gray-600' :
                    'bg-red-100 text-red-700'
                  }`}>{t.employment_status}</span>
                </div>
                <div className={`${columnWidths[7]} flex shrink-0 items-center gap-1 px-2 py-2`}>
                  <Button variant="ghost" size="icon" onClick={() => onEdit(t)} title="Edit">
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => onDelete(t)} title="Delete">
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
