import { useState, useEffect } from 'react'
import { Helmet } from 'react-helmet-async'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useAttendanceRecordsWithFilters,
  useAttendanceTeachers,
} from '@/hooks/useAttendanceRecords'
import { exportToCSV, exportToExcel, exportToPDF, exportAllAttendance } from '@/services/admin'
import type { AttendanceFilters } from '@/services/admin'
import { ExportMenu } from '@/components/ExportMenu'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'

export default function AttendanceRecordsPage() {
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [dateFilter, setDateFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [teacherFilter, setTeacherFilter] = useState('')

  const filters: AttendanceFilters = { page, page_size: pageSize }
  if (dateFilter) filters.date = dateFilter
  if (statusFilter) filters.status = statusFilter
  if (teacherFilter) filters.teacher_id = teacherFilter

  const { records, total, totalPages, isLoading, error } = useAttendanceRecordsWithFilters(filters)

  useEffect(() => {
    if (error) toast.error(error.message)
  }, [error])
  const { data: teachers } = useAttendanceTeachers()

  const handleExport = async (format: 'csv' | 'xlsx' | 'pdf') => {
    try {
      const filename = `attendance_${new Date().toISOString().slice(0, 10)}`
      if (format === 'csv') exportToCSV(records, filename)
      else if (format === 'xlsx') await exportToExcel(records, filename)
      else await exportToPDF(records, filename)
      toast.success(`Exported as ${format.toUpperCase()}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed')
    }
  }

  const handleExportAll = (format: 'csv' | 'xlsx' | 'pdf') => {
    const filename = `attendance_all_${new Date().toISOString().slice(0, 10)}`
    toast.promise(exportAllAttendance(format, filename), {
      loading: 'Exporting all records...',
      success: `All records exported as ${format.toUpperCase()}`,
      error: 'Failed to export records',
    })
  }

  return (
    <>
      <Helmet>
        <title>Attendance Records — Admin | JK Attendance System</title>
        <meta name="description" content="View and export attendance records with filters" />
        <meta name="robots" content="noindex, follow" />
      </Helmet>
      <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Attendance Records</h1>
        <div className="flex gap-2">
          <ExportMenu label="Export Page"
            onExportCSV={() => handleExport('csv')}
            onExportExcel={() => handleExport('xlsx')}
            onExportPDF={() => handleExport('pdf')}
          />
          <ExportMenu label="Export All"
            onExportCSV={() => handleExportAll('csv')}
            onExportExcel={() => handleExportAll('xlsx')}
            onExportPDF={() => handleExportAll('pdf')}
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap gap-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Date</label>
              <Input type="date" value={dateFilter} onChange={e => { setDateFilter(e.target.value); setPage(1) }} className="h-9 w-44" />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Status</label>
              <select
                className="flex h-9 w-36 rounded-md border border-input bg-background px-3 py-1 text-sm"
                value={statusFilter}
                onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
              >
                <option value="">All</option>
                <option value="present">Present</option>
                <option value="late">Late</option>
                <option value="absent">Absent</option>
                <option value="checked_out">Checked Out</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Teacher</label>
              <select
                className="flex h-9 w-48 rounded-md border border-input bg-background px-3 py-1 text-sm"
                value={teacherFilter}
                onChange={e => { setTeacherFilter(e.target.value); setPage(1) }}
              >
                <option value="">All Teachers</option>
                {(teachers ?? []).map(t => (
                  <option key={t.id} value={t.id}>{t.full_name} ({t.staff_number})</option>
                ))}
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3 py-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : records.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No records found.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th scope="col" className="pb-2 font-medium">Teacher</th>
                      <th scope="col" className="pb-2 font-medium">Staff No.</th>
                      <th scope="col" className="pb-2 font-medium">Date</th>
                      <th scope="col" className="pb-2 font-medium">Check In</th>
                      <th scope="col" className="pb-2 font-medium">Check Out</th>
                      <th scope="col" className="pb-2 font-medium">Status</th>
                      <th scope="col" className="pb-2 font-medium">Late</th>
                      <th scope="col" className="pb-2 font-medium">Working</th>
                      <th scope="col" className="pb-2 font-medium">Location</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((r) => (
                      <tr key={r.id} className="border-b last:border-0 hover:bg-muted/50">
                        <td className="py-2 font-medium">{r.teacher?.full_name ?? '-'}</td>
                        <td className="py-2 text-muted-foreground">{r.teacher?.staff_number ?? '-'}</td>
                        <td className="py-2">{r.attendance_date}</td>
                        <td className="py-2">{r.check_in ? new Date(r.check_in).toLocaleTimeString() : '-'}</td>
                        <td className="py-2">{r.check_out ? new Date(r.check_out).toLocaleTimeString() : '-'}</td>
                        <td className="py-2">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            r.status === 'present' ? 'bg-green-100 text-green-700' :
                            r.status === 'late' ? 'bg-yellow-100 text-yellow-700' :
                            r.status === 'absent' ? 'bg-red-100 text-red-700' :
                            'bg-purple-100 text-purple-700'
                          }`}>{r.status}</span>
                        </td>
                        <td className="py-2">{r.late_minutes ?? '-'}</td>
                        <td className="py-2">{r.working_minutes ?? '-'}</td>
                        <td className="py-2 text-xs text-muted-foreground">
                          {r.location_status === 'inside_school' ? 'In School' :
                           r.location_status === 'outside_school' ? `${r.distance_from_school ?? '?'}m` : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between mt-4 text-sm">
                <span className="text-muted-foreground">
                  Page {page} of {totalPages} ({total} total)
                </span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-muted-foreground">{page} / {totalPages}</span>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
    </>
  )
}
