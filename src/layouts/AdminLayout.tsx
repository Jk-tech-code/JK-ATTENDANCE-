import type { ReactNode } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useTheme } from '@/hooks/useTheme'
import { Button } from '@/components/ui/button'
import {
  LogOut,
  LayoutDashboard,
  MapPin,
  ChevronLeft,
  ChevronRight,
  Users,
  ClipboardList,
  BarChart3,
  CalendarDays,
  Sun,
  Moon,
} from 'lucide-react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useState } from 'react'
import { NotificationBell } from '@/components/NotificationBell'

interface AdminLayoutProps {
  children: ReactNode
}

const navItems = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard },
  { href: '/admin/teachers', label: 'Teachers', icon: Users },
  { href: '/admin/attendance', label: 'Attendance', icon: ClipboardList },
  { href: '/admin/calendar', label: 'Calendar', icon: CalendarDays },
  { href: '/admin/holidays', label: 'Holidays', icon: Sun },
  { href: '/admin/reports', label: 'Reports', icon: BarChart3 },
  { href: '/admin/settings', label: 'Settings', icon: MapPin },
]

export function AdminLayout({ children }: AdminLayoutProps) {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { theme, toggleTheme } = useTheme()
  const [collapsed, setCollapsed] = useState(false)

  const handleSignOut = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex min-h-screen bg-muted/30">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:shadow-lg">
        Skip to main content
      </a>
      <aside
        role="navigation"
        aria-label="Admin navigation"
        className={`flex flex-col border-r bg-background transition-all duration-200 ${
          collapsed ? 'w-16' : 'w-56'
        }`}
      >
        <div role="banner" className="flex h-14 items-center justify-between border-b px-4">
          {!collapsed && (
            <div className="flex items-center gap-2">
              <img src="/4_transparent_background.png" alt="JK Attendance" loading="lazy" className="h-8 w-8 object-contain" />
              <span className="text-sm font-semibold">Admin</span>
            </div>
          )}
          {collapsed && (
            <div className="mx-auto">
              <img src="/4_transparent_background.png" alt="JK Attendance" loading="lazy" className="h-8 w-8 object-contain" />
            </div>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="rounded-md p-1 hover:bg-accent"
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </button>
        </div>

        <nav className="flex-1 space-y-1 p-2">
          {navItems.map((item) => {
            const isActive = location.pathname === item.href
            return (
              <Link
                key={item.href}
                to={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-accent font-medium text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                }`}
                title={collapsed ? item.label : undefined}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            )
          })}
        </nav>

        <div className="border-t p-2">
          {!collapsed && (
            <div className="mb-2 px-3 py-2">
              <p className="truncate text-sm font-medium">
                {user?.teacher?.full_name ?? user?.profile?.full_name ?? user?.email}
              </p>
              <p className="truncate text-xs text-muted-foreground">Admin</p>
            </div>
          )}
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className={`justify-start gap-2 ${collapsed ? 'mx-auto px-2' : 'w-full'}`}
              onClick={() => navigate('/dashboard')}
            >
              <LayoutDashboard className="h-4 w-4" />
              {!collapsed && <span>Dashboard</span>}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleSignOut}
              aria-label="Sign out"
              title="Sign out"
              className={collapsed ? 'mx-auto' : ''}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-auto">
        <header className="flex h-14 items-center justify-end gap-2 border-b bg-background px-4 sm:px-6">
          <NotificationBell />
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="text-muted-foreground hover:text-foreground"
          >
            <Sun className="h-4 w-4 scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
            <Moon className="absolute h-4 w-4 scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
          </Button>
          <span className="text-xs text-muted-foreground hidden sm:inline">
            {user?.teacher?.full_name ?? user?.profile?.full_name ?? user?.email}
          </span>
        </header>
        <main role="main" id="main-content" className="flex-1">
          <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{children}</div>
        </main>
      </div>
    </div>
  )
}
