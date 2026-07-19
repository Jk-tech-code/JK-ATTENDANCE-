import { Helmet } from 'react-helmet-async'
import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { MapPin, Users, Calendar, Settings, ClipboardList, FileText, BarChart } from 'lucide-react'

export default function AdminOverviewPage() {
  const links = [
    {
      title: 'Dashboard',
      description: 'View attendance stats, reports, and quick overview',
      icon: MapPin,
      href: '/admin/dashboard',
    },
    {
      title: 'Teachers',
      description: 'Manage teacher accounts and profiles',
      icon: Users,
      href: '/admin/teachers',
    },
    {
      title: 'Attendance Records',
      description: 'View and export attendance records with filters',
      icon: ClipboardList,
      href: '/admin/attendance',
    },
    {
      title: 'Calendar',
      description: 'View and manage the school calendar',
      icon: Calendar,
      href: '/admin/calendar',
    },
    {
      title: 'Reports',
      description: 'Attendance reports, analytics and AI insights',
      icon: BarChart,
      href: '/admin/reports',
    },
    {
      title: 'Holidays',
      description: 'Manage school holidays and closures',
      icon: FileText,
      href: '/admin/holidays',
    },
    {
      title: 'Settings',
      description: 'Configure GPS, time rules, and system preferences',
      icon: Settings,
      href: '/admin/settings',
    },
  ]

  return (
    <>
      <Helmet>
        <title>Admin Overview — JK Attendance System</title>
        <meta name="description" content="Admin dashboard for Glorious Group of Schools attendance system" />
        <meta name="robots" content="noindex, follow" />
      </Helmet>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Admin Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Manage Glorious Group of Schools attendance system
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {links.map((link) => (
            <Link key={link.href} to={link.href}>
              <Card className="transition-colors hover:bg-accent/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <link.icon className="h-4 w-4" />
                    {link.title}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{link.description}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </>
  )
}
