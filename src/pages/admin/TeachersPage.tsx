import { useState, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Helmet } from 'react-helmet-async'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog } from '@/components/ui/dialog'
import { AlertDialog } from '@/components/ui/alert-dialog'
import { useDebounce } from '@/hooks/useDebounce'
import {
  useTeachers,
  useCreateTeacher,
  useUpdateTeacher,
  useDeleteTeacher,
  useInviteTeacher,
  useResendInvite,
} from '@/hooks/useTeachers'
import { InviteTeacherModal, type InviteTeacherFormData } from '@/components/InviteTeacherModal'
import type { Teacher } from '@/types'
import { Plus, Pencil, Trash2, Search, UserPlus, Users, Mail, Copy, CheckCircle2 } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { useVirtualizer } from '@tanstack/react-virtual'

const teacherSchema = z.object({
  staff_number: z.string().min(1, 'Staff number is required').max(50, 'Staff number too long'),
  full_name: z.string().min(1, 'Full name is required').max(200, 'Name too long'),
  email: z.string().min(1, 'Email is required').email('Enter a valid email address').max(254),
  department: z.string().max(200).optional().or(z.literal('')),
  phone: z.string().max(30).optional().or(z.literal('')),
  reporting_time: z.string().optional().or(z.literal('')),
  employment_status: z.enum(['active', 'inactive', 'suspended']),
})

type TeacherFormData = z.infer<typeof teacherSchema>

const defaultFormValues: TeacherFormData = {
  staff_number: '',
  full_name: '',
  email: '',
  department: '',
  phone: '',
  reporting_time: '07:20',
  employment_status: 'active',
}

export default function TeachersPage() {
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)

  const { data: teachers, isLoading } = useTeachers({
    page: 1,
    pageSize: 100,
    search: debouncedSearch || undefined,
  })
  const createMutation = useCreateTeacher()
  const updateMutation = useUpdateTeacher()
  const deleteMutation = useDeleteTeacher()
  const inviteMutation = useInviteTeacher()
  const resendMutation = useResendInvite()

  const [editing, setEditing] = useState<Teacher | null>(null)
  const [open, setOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Teacher | null>(null)
  const [createdTeacher, setCreatedTeacher] = useState<{
    name: string
    email: string
    tempPassword: string
  } | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isValid },
  } = useForm<TeacherFormData>({
    resolver: zodResolver(teacherSchema),
    mode: 'onChange',
    defaultValues: defaultFormValues,
  })

  const openCreate = () => {
    setEditing(null)
    reset(defaultFormValues)
    setOpen(true)
  }

  const openEdit = (t: Teacher) => {
    setEditing(t)
    reset({
      staff_number: t.staff_number,
      full_name: t.full_name,
      email: t.email,
      department: t.department ?? '',
      phone: t.phone ?? '',
      reporting_time: t.reporting_time ?? '07:20',
      employment_status: (t.employment_status as TeacherFormData['employment_status']) ?? 'active',
    })
    setOpen(true)
  }

  const onFormSubmit = async (data: TeacherFormData) => {
    const trimmed = {
      staff_number: data.staff_number.trim(),
      full_name: data.full_name.trim(),
      email: data.email.trim(),
      department: data.department?.trim() || undefined,
      phone: data.phone?.trim() || undefined,
      reporting_time: data.reporting_time || undefined,
      employment_status: data.employment_status,
    }

    try {
      if (editing) {
        await updateMutation.mutateAsync({ id: editing.id, input: trimmed })
        toast.success('Teacher updated successfully')
      } else {
        const result = await createMutation.mutateAsync(trimmed)
        if (result.temp_password) {
          setCreatedTeacher({
            name: trimmed.full_name,
            email: trimmed.email,
            tempPassword: result.temp_password,
          })
        } else {
          toast.success('Teacher account created')
        }
      }
      setOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync(deleteTarget.id)
      toast.success('Teacher deleted successfully')
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleInvite = async (data: InviteTeacherFormData) => {
    try {
      await inviteMutation.mutateAsync(data)
      toast.success('Teacher account created', {
        description: `${data.email} can now log in with their temporary password.`,
        duration: 10000,
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleResendInvite = async (teacher: Teacher) => {
    try {
      const result = await resendMutation.mutateAsync({
        staff_number: teacher.staff_number,
        full_name: teacher.full_name,
        email: teacher.email,
      })
      if (result.temp_password) {
        setCreatedTeacher({
          name: teacher.full_name,
          email: teacher.email,
          tempPassword: result.temp_password,
        })
      } else {
        toast.success('New temporary password generated')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const deleting = deleteMutation.isPending

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
            <Button onClick={() => setInviteOpen(true)}>
              <UserPlus className="mr-2 h-4 w-4" />
              Invite Teacher
            </Button>
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Add Teacher
            </Button>
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
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 h-9"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3 p-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : !teachers || teachers.length === 0 ? (
              debouncedSearch ? (
                <EmptyState
                  title="No matching teachers"
                  description="Try a different search term."
                  icon={<Search className="h-12 w-12" />}
                />
              ) : (
                <EmptyState
                  title="No teachers yet"
                  description="Add your first teacher to get started."
                  icon={<Users className="h-12 w-12" />}
                  action={{ label: 'Add Teacher', onClick: openCreate }}
                />
              )
            ) : (
              <div className="overflow-x-auto">
                <VirtualizedTeacherTable
                  teachers={teachers}
                  onEdit={openEdit}
                  onDelete={(t) => setDeleteTarget(t)}
                  onResendInvite={handleResendInvite}
                />
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog
          open={open}
          onOpenChange={(o) => {
            if (!o && !isSubmitting) reset()
            setOpen(o)
          }}
          title={editing ? 'Edit Teacher' : 'Add Teacher'}
        >
          <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-staff-number">
                  Staff Number <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="edit-staff-number"
                  {...register('staff_number')}
                  className={errors.staff_number ? 'border-destructive' : ''}
                />
                {errors.staff_number && (
                  <p className="text-xs text-destructive">{errors.staff_number.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-full-name">
                  Full Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="edit-full-name"
                  {...register('full_name')}
                  className={errors.full_name ? 'border-destructive' : ''}
                />
                {errors.full_name && (
                  <p className="text-xs text-destructive">{errors.full_name.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-email">
                  Email <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="edit-email"
                  type="email"
                  {...register('email')}
                  disabled={!!editing}
                  className={errors.email ? 'border-destructive' : ''}
                />
                {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-department">Department</Label>
                <Input id="edit-department" {...register('department')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-phone">Phone</Label>
                <Input
                  id="edit-phone"
                  {...register('phone')}
                  className={errors.phone ? 'border-destructive' : ''}
                />
                {errors.phone && <p className="text-xs text-destructive">{errors.phone.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-reporting-time">Reporting Time</Label>
                <Input id="edit-reporting-time" type="time" {...register('reporting_time')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-status">Status</Label>
                <select
                  id="edit-status"
                  {...register('employment_status')}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="suspended">Suspended</option>
                </select>
              </div>
            </div>
            <Button
              type="submit"
              className="w-full"
              loading={isSubmitting}
              disabled={!isValid || isSubmitting}
            >
              {editing ? 'Update' : 'Create'} Teacher
            </Button>
          </form>
        </Dialog>

        <InviteTeacherModal
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          onSubmit={handleInvite}
        />

        <AlertDialog
          open={!!deleteTarget}
          onOpenChange={(o) => {
            if (!o) setDeleteTarget(null)
          }}
          title="Delete Teacher"
          description={`Are you sure you want to delete ${deleteTarget?.full_name}? This will permanently remove their record and all associated attendance data.`}
          confirmLabel="Delete"
          variant="destructive"
          onConfirm={handleDelete}
          loading={deleting}
        />

        <Dialog
          open={!!createdTeacher}
          onOpenChange={(o) => {
            if (!o) setCreatedTeacher(null)
          }}
          title="Teacher Account Created"
        >
          {createdTeacher && (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/50 p-4">
                <p className="text-sm text-muted-foreground mb-2">
                  Share this temporary password with <strong>{createdTeacher.name}</strong>:
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded bg-background px-3 py-2 text-sm font-mono border">
                    {createdTeacher.tempPassword}
                  </code>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => {
                      navigator.clipboard.writeText(createdTeacher.tempPassword)
                      toast.success('Password copied')
                    }}
                    title="Copy password"
                    aria-label="Copy password"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                The teacher should log in at <strong>{createdTeacher.email}</strong> and change this
                password from their dashboard menu.
              </p>
              <Button
                className="w-full"
                onClick={() => setCreatedTeacher(null)}
              >
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Done
              </Button>
            </div>
          )}
        </Dialog>
      </div>
    </>
  )
}

function VirtualizedTeacherTable({
  teachers,
  onEdit,
  onDelete,
  onResendInvite,
}: {
  teachers: Teacher[]
  onEdit: (t: Teacher) => void
  onDelete: (t: Teacher) => void
  onResendInvite: (t: Teacher) => void
}) {
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: teachers.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 45,
    overscan: 10,
  })

  const columnWidths = [
    'flex-[1.2]',
    'flex-[2]',
    'flex-[2]',
    'flex-[1.5]',
    'flex-[1.2]',
    'flex-[0.9]',
    'flex-[1]',
    'w-28 shrink-0',
  ]

  return (
    <div role="grid" aria-label="Teachers">
      <div role="row" className="flex items-center border-b pb-2 text-left text-xs font-medium text-muted-foreground">
        <div role="columnheader" className={`${columnWidths[0]} px-2`}>Staff No.</div>
        <div role="columnheader" className={`${columnWidths[1]} px-2`}>Name</div>
        <div role="columnheader" className={`${columnWidths[2]} px-2`}>Email</div>
        <div role="columnheader" className={`${columnWidths[3]} px-2`}>Department</div>
        <div role="columnheader" className={`${columnWidths[4]} px-2`}>Phone</div>
        <div role="columnheader" className={`${columnWidths[5]} px-2`}>Reporting</div>
        <div role="columnheader" className={`${columnWidths[6]} px-2`}>Status</div>
        <div role="columnheader" className={`${columnWidths[7]} px-2`}>Actions</div>
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
                role="row"
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
                <div role="gridcell" className={`${columnWidths[0]} min-w-0 px-2 py-2 truncate`}>
                  {t.staff_number}
                </div>
                <div role="gridcell" className={`${columnWidths[1]} min-w-0 px-2 py-2 truncate font-medium`}>
                  {t.full_name}
                </div>
                <div
                  role="gridcell"
                  className={`${columnWidths[2]} min-w-0 px-2 py-2 truncate text-muted-foreground`}
                >
                  {t.email}
                </div>
                <div
                  role="gridcell"
                  className={`${columnWidths[3]} min-w-0 px-2 py-2 truncate text-muted-foreground`}
                >
                  {t.department ?? '-'}
                </div>
                <div
                  role="gridcell"
                  className={`${columnWidths[4]} min-w-0 px-2 py-2 truncate text-muted-foreground`}
                >
                  {t.phone ?? '-'}
                </div>
                <div role="gridcell" className={`${columnWidths[5]} min-w-0 px-2 py-2 truncate`}>
                  {t.reporting_time ?? '07:20'}
                </div>
                <div role="gridcell" className={`${columnWidths[6]} min-w-0 px-2 py-2`}>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      t.employment_status === 'active'
                        ? 'bg-green-100 text-green-700'
                        : t.employment_status === 'inactive'
                          ? 'bg-gray-100 text-gray-600'
                          : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {t.employment_status}
                  </span>
                </div>
                <div role="gridcell" className={`${columnWidths[7]} flex shrink-0 items-center gap-1 px-2 py-2`}>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onResendInvite(t)}
                    title="Resend invite"
                    aria-label="Resend invite"
                  >
                    <Mail className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => onEdit(t)} title="Edit" aria-label="Edit teacher">
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => onDelete(t)} title="Delete" aria-label="Delete teacher">
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
