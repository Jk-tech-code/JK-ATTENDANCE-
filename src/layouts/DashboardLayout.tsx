import type { ReactNode } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useTheme } from '@/hooks/useTheme'
import { Button } from '@/components/ui/button'
import { LogOut, User, Shield, Moon, Sun } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { NotificationBell } from '@/components/NotificationBell'

interface DashboardLayoutProps {
  children: ReactNode
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  const { theme, toggleTheme } = useTheme()

  return (
    <div className="min-h-screen bg-muted/30">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:shadow-lg">
        Skip to main content
      </a>
      <header role="banner" className="sticky top-0 z-10 border-b bg-background">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <img src="/4_transparent_background.png" alt="JK Attendance" loading="lazy" className="h-8 w-8 object-contain" />
            <span className="text-sm font-semibold">Attendance</span>
          </div>
          <div className="flex items-center gap-1">
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
            <div className="hidden items-center gap-2 sm:flex">
              <User className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {user?.teacher?.full_name ?? user?.profile?.full_name ?? user?.email}
              </span>
            </div>
            {user?.role === 'admin' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/admin')}
                className="gap-1.5 text-xs"
              >
                <Shield className="h-3.5 w-3.5" />
                Admin
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={handleSignOut} aria-label="Sign out" title="Sign out">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>
      <main role="main" id="main-content" className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  )
}
