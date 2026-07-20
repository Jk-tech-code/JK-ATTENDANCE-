import { lazy } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import { Toaster } from 'sonner'
import { useAuth } from '@/hooks/useAuth'
import { AdminLayout } from '@/layouts/AdminLayout'
import { RouteErrorBoundary } from '@/components/ui/ErrorPage'
import { Loader2 } from 'lucide-react'

const LandingPage = lazy(() => import('@/pages/LandingPage'))
const LoginPage = lazy(() => import('@/pages/LoginPage'))
const ForgotPasswordPage = lazy(() => import('@/pages/ForgotPasswordPage'))
const ResetPasswordPage = lazy(() => import('@/pages/ResetPasswordPage'))
const DashboardPage = lazy(() => import('@/pages/DashboardPage'))
const HelpPage = lazy(() => import('@/pages/HelpPage'))
const AdminOverviewPage = lazy(() => import('@/pages/admin/AdminOverviewPage'))
const AdminDashboardPage = lazy(() => import('@/pages/admin/AdminDashboardPage'))
const TeachersPage = lazy(() => import('@/pages/admin/TeachersPage'))
const AttendanceRecordsPage = lazy(() => import('@/pages/admin/AttendanceRecordsPage'))
const ReportsPage = lazy(() => import('@/pages/admin/ReportsPage'))
const CalendarPage = lazy(() => import('@/pages/admin/CalendarPage'))
const HolidayManagementPage = lazy(() => import('@/pages/admin/HolidayManagementPage'))
const SettingsPage = lazy(() => import('@/pages/admin/SettingsPage'))
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'))

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  return <RouteErrorBoundary>{children}</RouteErrorBoundary>
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== 'admin') return <Navigate to="/dashboard" replace />
  return <AdminLayout><RouteErrorBoundary>{children}</RouteErrorBoundary></AdminLayout>
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (user) return <Navigate to={user.role === 'admin' ? '/admin' : '/dashboard'} replace />
  return <RouteErrorBoundary>{children}</RouteErrorBoundary>
}

export default function App() {
  return (
    <BrowserRouter>
      <Helmet>
        <html lang="en" />
        <title>JK Attendance System</title>
        <meta name="description" content="Modern school attendance management platform for teacher attendance tracking, reporting, analytics, and school administration." />
      </Helmet>
      <Toaster position="top-right" richColors />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
        <Route path="/forgot-password" element={<PublicRoute><ForgotPasswordPage /></PublicRoute>} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
        <Route path="/help" element={<HelpPage />} />
        <Route path="/admin" element={<AdminRoute><AdminOverviewPage /></AdminRoute>} />
        <Route path="/admin/dashboard" element={<AdminRoute><AdminDashboardPage /></AdminRoute>} />
        <Route path="/admin/teachers" element={<AdminRoute><TeachersPage /></AdminRoute>} />
        <Route path="/admin/attendance" element={<AdminRoute><AttendanceRecordsPage /></AdminRoute>} />
        <Route path="/admin/calendar" element={<AdminRoute><CalendarPage /></AdminRoute>} />
        <Route path="/admin/holidays" element={<AdminRoute><HolidayManagementPage /></AdminRoute>} />
        <Route path="/admin/reports" element={<AdminRoute><ReportsPage /></AdminRoute>} />
        <Route path="/admin/settings" element={<AdminRoute><SettingsPage /></AdminRoute>} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  )
}
