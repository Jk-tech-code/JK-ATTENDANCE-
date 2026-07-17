import { useEffect, useState, useMemo } from 'react'
import { Helmet } from 'react-helmet-async'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog } from '@/components/ui/dialog'
import { AlertDialog } from '@/components/ui/alert-dialog'
import { useDebounce } from '@/hooks/useDebounce'
import { getTeachers, createTeacher, updateTeacher, deleteTeacher, inviteTeacher } from '@/services/admin'
import type { Teacher } from '@/types'
import { Plus, Pencil, Trash2, Search, UserPlus } from 'lucide-react'
import { toast } from 'sonner'

export default function TeachersPage() {
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  const [editing, setEditing] = useState<Teacher | null>(null)
  const [open, setOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Teacher | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [form, setForm] = useState({
    staff_number: '',
    full_name: '',
    email: '',
    department: '',
    phone: '',
    reporting_time: '07:20',
    employment_status: 'active',
  })
  const [inviteForm, setInviteForm] = useState({
    staff_number: '',
    full_name: '',
    email: '',
    department: '',
    phone: '',
    reporting_time: '07:20',
  })

  const load = () => {
    setLoading(true)
    getTeachers()
      .then(setTeachers)
      .catch(() => toast.error('Failed to load teachers'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
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
    setForm({ staff_number: '', full_name: '', email: '', department: '', phone: '', reporting_time: '07:20', employment_status: 'active' })
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
    setOpen(true)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      if (editing) {
        await updateTeacher(editing.id, form)
        toast.success('Teacher updated successfully')
      } else {
        await createTeacher(form)
        toast.success('Teacher created successfully')
      }
      setOpen(false)
      load()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteTeacher(deleteTarget.id)
      toast.success('Teacher deleted successfully')
      setDeleteTarget(null)
      load()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setDeleting(false)
    }
  }

  const handleInvite = async () => {
    setInviting(true)
    try {
      const { tempPassword } = await inviteTeacher(inviteForm)
      setInviteOpen(false)
      toast.success('Teacher invited successfully', {
        description: `Email: ${inviteForm.email}\nTemporary password: ${tempPassword}`,
        duration: 15000,
      })
      load()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setInviting(false)
    }
  }

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
          <Button onClick={() => { setInviteForm({ staff_number: '', full_name: '', email: '', department: '', phone: '', reporting_time: '07:20' }); setInviteOpen(true) }}>
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
          {loading ? (
            <p className="text-center text-muted-foreground py-8">Loading...</p>
          ) : filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No teachers found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 font-medium">Staff No.</th>
                    <th className="pb-2 font-medium">Name</th>
                    <th className="pb-2 font-medium">Email</th>
                    <th className="pb-2 font-medium">Department</th>
                    <th className="pb-2 font-medium">Phone</th>
                    <th className="pb-2 font-medium">Reporting</th>
                    <th className="pb-2 font-medium">Status</th>
                    <th className="pb-2 font-medium w-24">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t) => (
                    <tr key={t.id} className="border-b last:border-0 hover:bg-muted/50">
                      <td className="py-2">{t.staff_number}</td>
                      <td className="py-2 font-medium">{t.full_name}</td>
                      <td className="py-2 text-muted-foreground">{t.email}</td>
                      <td className="py-2 text-muted-foreground">{t.department ?? '-'}</td>
                      <td className="py-2 text-muted-foreground">{t.phone ?? '-'}</td>
                      <td className="py-2">{t.reporting_time ?? '07:20'}</td>
                      <td className="py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          t.employment_status === 'active' ? 'bg-green-100 text-green-700' :
                          t.employment_status === 'inactive' ? 'bg-gray-100 text-gray-600' :
                          'bg-red-100 text-red-700'
                        }`}>{t.employment_status}</span>
                      </td>
                      <td className="py-2">
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(t)} title="Edit">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(t)} title="Delete">
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen} title={editing ? 'Edit Teacher' : 'Add Teacher'}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Staff Number</Label>
              <Input value={form.staff_number} onChange={e => setForm({ ...form, staff_number: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Full Name</Label>
              <Input value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} disabled={!!editing} />
            </div>
            <div className="space-y-2">
              <Label>Department</Label>
              <Input value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
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
          <Button onClick={handleSave} className="w-full" loading={saving}>
            {editing ? 'Update' : 'Create'} Teacher
          </Button>
        </div>
      </Dialog>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen} title="Invite Teacher">
        <p className="text-sm text-muted-foreground mb-4">
          An auth user will be created and a temporary password generated. Share it with the teacher.
        </p>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Staff Number</Label>
              <Input value={inviteForm.staff_number} onChange={e => setInviteForm({ ...inviteForm, staff_number: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Full Name</Label>
              <Input value={inviteForm.full_name} onChange={e => setInviteForm({ ...inviteForm, full_name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={inviteForm.email} onChange={e => setInviteForm({ ...inviteForm, email: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Department</Label>
              <Input value={inviteForm.department} onChange={e => setInviteForm({ ...inviteForm, department: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={inviteForm.phone} onChange={e => setInviteForm({ ...inviteForm, phone: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Reporting Time</Label>
              <Input type="time" value={inviteForm.reporting_time} onChange={e => setInviteForm({ ...inviteForm, reporting_time: e.target.value })} />
            </div>
          </div>
          <Button onClick={handleInvite} className="w-full" loading={inviting}>
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
