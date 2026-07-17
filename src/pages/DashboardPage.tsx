import { Helmet } from 'react-helmet-async'
import { DashboardLayout } from '@/layouts/DashboardLayout'
import { ClockWidget } from '@/components/dashboard/ClockWidget'
import { ProfileCard } from '@/components/dashboard/ProfileCard'
import { AttendanceCard } from '@/components/dashboard/AttendanceCard'
import { SummaryCard } from '@/components/dashboard/SummaryCard'
import { DashboardCalendarWidget } from '@/components/dashboard/DashboardCalendarWidget'
import { useAuth } from '@/contexts/AuthContext'

export default function DashboardPage() {
  const { user } = useAuth()
  const teacher = user?.teacher

  return (
    <>
      <Helmet>
        <title>Dashboard — JK Attendance System</title>
        <meta name="description" content="Teacher attendance dashboard and check-in/check-out" />
        <meta name="robots" content="noindex, follow" />
      </Helmet>
      <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold">
              Welcome, {teacher?.full_name?.split(' ')[0] ?? 'Teacher'}
            </h1>
            <p className="text-sm text-muted-foreground">
              {teacher?.department ?? 'All Departments'} &middot; Staff #{teacher?.staff_number ?? 'N/A'}
            </p>
          </div>
          <ClockWidget />
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="md:col-span-2 space-y-4">
            <AttendanceCard />
          </div>
          <div className="space-y-4">
            <ProfileCard />
            <SummaryCard />
            <DashboardCalendarWidget />
          </div>
        </div>
      </div>
    </DashboardLayout>
    </>
  )
}
