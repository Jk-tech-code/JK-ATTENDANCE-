import type { ReactNode } from 'react'

interface AuthLayoutProps {
  children: ReactNode
  title: string
  subtitle?: string
}

export function AuthLayout({ children, title, subtitle }: AuthLayoutProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/50 px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-4 text-center">
          <img
            src="/1_full_color_version.png"
            alt="JK Attendance"
            loading="lazy"
            className="mx-auto h-16 w-16 object-contain"
          />
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {subtitle && (
              <p className="text-sm text-muted-foreground">{subtitle}</p>
            )}
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}
