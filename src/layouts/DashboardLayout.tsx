import { useState } from 'react'
import type { ReactNode } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useTheme } from '@/hooks/useTheme'
import { Button } from '@/components/ui/button'
import { LogOut, User, Shield, Moon, Sun, Key, HelpCircle } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { NotificationBell } from '@/components/NotificationBell'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { supabase } from '@/services/supabase'
import { toast } from 'sonner'

interface DashboardLayoutProps {
  children: ReactNode
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [pwOpen, setPwOpen] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwLoading, setPwLoading] = useState(false)

  const handleSignOut = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  const handleChangePassword = async () => {
    if (newPassword.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match')
      return
    }
    setPwLoading(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setPwLoading(false)
    if (error) {
      toast.error(error.message)
      return
    }
    toast.success('Password changed successfully')
    setPwOpen(false)
    setNewPassword('')
    setConfirmPassword('')
  }

  const { theme, toggleTheme } = useTheme()

  return (
    <div className="min-h-screen bg-muted/30">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:shadow-lg"
      >
        Skip to main content
      </a>
      <header className="sticky top-0 z-10 border-b bg-background">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <img
              src="/4_transparent_background.png"
              alt="JK Attendance"
              loading="lazy"
              className="h-8 w-8 object-contain"
            />
            <span className="text-sm font-semibold">Attendance</span>
          </div>
          <div className="flex items-center gap-1">
            <Link to="/help">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Help and FAQ"
                title="Help and FAQ"
                className="text-muted-foreground hover:text-foreground"
              >
                <HelpCircle className="h-4 w-4" aria-hidden="true" />
              </Button>
            </Link>
            <NotificationBell />
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="text-muted-foreground hover:text-foreground"
            >
              <Sun className="h-4 w-4 scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" aria-hidden="true" />
              <Moon className="absolute h-4 w-4 scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" aria-hidden="true" />
            </Button>
            <div className="hidden items-center gap-2 sm:flex">
              <User className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <span className="text-sm text-muted-foreground">
                {user?.teacher?.full_name ?? user?.profile?.full_name ?? user?.email}
              </span>
            </div>
            {(user?.role === 'admin' || user?.role === 'superadmin') && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/admin')}
                className="gap-1.5 text-xs"
              >
                <Shield className="h-3.5 w-3.5" aria-hidden="true" />
                {user?.role === 'superadmin' ? 'Superadmin' : 'Admin'}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setPwOpen(true)}
              aria-label="Change password"
              title="Change password"
              className="text-muted-foreground hover:text-foreground"
            >
              <Key className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleSignOut}
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <Dialog open={pwOpen} onOpenChange={setPwOpen} title="Change Password">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-pw">New Password</Label>
            <Input
              id="new-pw"
              type="password"
              placeholder="Min. 8 characters"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-pw">Confirm Password</Label>
            <Input
              id="confirm-pw"
              type="password"
              placeholder="Repeat password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          <Button
            className="w-full"
            onClick={handleChangePassword}
            disabled={pwLoading || !newPassword || !confirmPassword}
          >
            {pwLoading ? 'Saving...' : 'Save New Password'}
          </Button>
        </div>
      </Dialog>
      <main id="main-content" className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {children}
      </main>
    </div>
  )
}
