import type { AttendanceWithTeacher } from './attendance'
import { getAllAttendanceRecords } from './attendance'

// ─── CSV ─────────────────────────────────────────────────────
//
// RFC 4180: wrap fields containing commas, quotes, or newlines in
// double quotes and escape any embedded double quotes by doubling them.
function csvEscape(value: unknown): string {
  const s = value == null ? '' : String(value)
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function rowFromRecord(r: AttendanceWithTeacher): string[] {
  return [
    r.teacher?.full_name ?? '',
    r.teacher?.staff_number ?? '',
    r.attendance_date,
    r.check_in ? new Date(r.check_in).toLocaleTimeString() : '-',
    r.check_out ? new Date(r.check_out).toLocaleTimeString() : '-',
    r.status ?? '-',
    String(r.late_minutes ?? 0),
    String(r.working_minutes ?? 0),
  ]
}

export function exportToCSV(records: AttendanceWithTeacher[], filename: string) {
  const headers = [
    'Teacher',
    'Staff No.',
    'Date',
    'Check In',
    'Check Out',
    'Status',
    'Late (min)',
    'Working (min)',
  ]
  const rows = records.map((r) => [
    r.teacher?.full_name ?? '',
    r.teacher?.staff_number ?? '',
    r.attendance_date,
    r.check_in ? new Date(r.check_in).toLocaleTimeString() : '-',
    r.check_out ? new Date(r.check_out).toLocaleTimeString() : '-',
    r.status,
    r.late_minutes ?? 0,
    r.working_minutes ?? 0,
  ])
  const csv = [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n')
  // Prepend BOM so Excel opens UTF-8 (including accented names) correctly.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Excel ───────────────────────────────────────────────────
export async function exportToExcel(
  records: AttendanceWithTeacher[],
  filename: string
): Promise<void> {
  const headers = [
    [
      'Teacher',
      'Staff No.',
      'Date',
      'Check In',
      'Check Out',
      'Status',
      'Late (min)',
      'Working (min)',
    ],
  ]
  const rows = records.map((r) => rowFromRecord(r))
  const wsData = [...headers, ...rows]

  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(wsData)
  XLSX.utils.book_append_sheet(wb, ws, 'Attendance')
  XLSX.writeFile(wb, `${filename}.xlsx`)
}

// ─── PDF ─────────────────────────────────────────────────────
export async function exportToPDF(
  records: AttendanceWithTeacher[],
  filename: string
): Promise<void> {
  try {
    const headers = [
      'Teacher',
      'Staff No.',
      'Date',
      'Check In',
      'Check Out',
      'Status',
      'Late (min)',
      'Working (min)',
    ]
    const rows = records.map((r) => rowFromRecord(r))

    const totals = records.reduce(
      (acc, r) => {
        const s = (r.status ?? '').toLowerCase()
        if (s === 'present' || s === 'checked_out') acc.present++
        else if (s === 'late') acc.late++
        else if (s === 'absent') acc.absent++
        return acc
      },
      { present: 0, absent: 0, late: 0 }
    )

    const [{ default: jsPDF }, { autoTable }] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ])

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const marginLeft = 14

    doc.setFontSize(14)
    doc.text('JK Attendance System', marginLeft, 15)
    doc.setFontSize(10)
    doc.text(`Attendance Report - ${filename}`, marginLeft, 22)
    doc.setFontSize(8)
    doc.text(`Generated: ${new Date().toLocaleString()}`, marginLeft, 28)

    autoTable(doc, {
      startY: 32,
      head: [headers],
      body: rows,
      styles: { fontSize: 7 },
      headStyles: { fillColor: [59, 130, 246] },
      foot: [
        [
          `Present: ${totals.present}`,
          '',
          '',
          '',
          '',
          `Absent: ${totals.absent}`,
          `Late: ${totals.late}`,
          `Total: ${records.length}`,
        ],
      ],
      footStyles: {
        fillColor: [243, 244, 246],
        textColor: [0, 0, 0],
        fontStyle: 'bold',
        fontSize: 7,
      },
      didDrawPage: (data) => {
        const pageHeight = doc.internal.pageSize.getHeight()
        doc.setFontSize(8)
        doc.text(`Page ${data.pageNumber}`, marginLeft, pageHeight - 10)
      },
    })

    doc.save(`${filename}.pdf`)
  } catch (error) {
    console.error('[exportToPDF] Failed to generate PDF:', error)
    throw new Error('Failed to generate PDF report. Please try again.')
  }
}

// ─── Export all pages ────────────────────────────────────────
export async function exportAllAttendance(
  format: 'csv' | 'xlsx' | 'pdf',
  filename: string
): Promise<void> {
  const records = await getAllAttendanceRecords()
  if (format === 'csv') exportToCSV(records, filename)
  else if (format === 'xlsx') await exportToExcel(records, filename)
  else await exportToPDF(records, filename)
}
