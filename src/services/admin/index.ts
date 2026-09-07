// Barrel export for the admin service layer.
//
// Existing code imports from '@/services/admin'. This file preserves
// that import path while delegating to the focused submodules:
//
//   - dashboard.ts       — getDashboardStats, getDailyReport, getMonthlyReport
//   - teachers.ts        — getTeachers, getAllTeachers, createTeacher,
//                          updateTeacher, deleteTeacher, inviteTeacher
//   - holidays.ts        — getHolidays, createHoliday, deleteHoliday
//   - schoolSettings.ts  — getSchoolSettings, updateSchoolSettings
//   - attendance.ts      — getAttendanceRecords, getAllAttendanceRecords,
//                          pageAllAttendance, POSTGREST_MAX_PAGE_SIZE,
//                          AttendanceFilters / AttendanceWithTeacher types
//   - exports.ts         — exportToCSV, exportToExcel, exportToPDF,
//                          exportAllAttendance
//
// New code should import directly from the focused submodule so the
// dependency graph stays narrow. The barrel is kept to avoid
// churning every existing call site.

export * from './dashboard'
export * from './teachers'
export * from './holidays'
export * from './schoolSettings'
export * from './attendance'
export * from './exports'
