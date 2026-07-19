import type { ReactNode } from 'react'
import { useEffect, useRef, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { X } from 'lucide-react'

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
  title?: string
  className?: string
}

const focusableSelector = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Dialog({ open, onOpenChange, children, title, className }: DialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)

  const getFocusableElements = useCallback(() => {
    if (!contentRef.current) return []
    return Array.from(contentRef.current.querySelectorAll<HTMLElement>(focusableSelector))
  }, [])

  const trapFocus = useCallback((e: KeyboardEvent) => {
    if (e.key !== 'Tab') return
    const elements = getFocusableElements()
    if (elements.length === 0) return
    const first = elements[0]
    const last = elements[elements.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }, [getFocusableElements])

  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement as HTMLElement
      document.addEventListener('keydown', trapFocus)
      document.body.style.overflow = 'hidden'
      const timer = setTimeout(() => {
        const elements = getFocusableElements()
        if (elements.length > 0) elements[0].focus()
      }, 50)
      return () => {
        clearTimeout(timer)
        document.removeEventListener('keydown', trapFocus)
        document.body.style.overflow = ''
        triggerRef.current?.focus()
      }
    }
  }, [open, trapFocus, getFocusableElements])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onOpenChange(false)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        ref={overlayRef}
        className="absolute inset-0 bg-black/50"
        onClick={() => onOpenChange(false)}
      />
      <div
        ref={contentRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={cn(
          'relative z-50 w-full max-w-md rounded-lg border bg-card p-6 shadow-lg',
          className
        )}
      >
        {title && (
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button
              onClick={() => onOpenChange(false)}
              className="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100"
              aria-label="Close dialog"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}
