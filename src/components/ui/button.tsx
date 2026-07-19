import type { ButtonHTMLAttributes, ReactElement, JSX } from 'react'
import { forwardRef, isValidElement, cloneElement } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link'
  size?: 'default' | 'sm' | 'lg' | 'icon'
  asChild?: boolean
  loading?: boolean
}

/**
 * Minimal Slot implementation — merges incoming props onto a single child element.
 * Replaces @radix-ui/react-slot to avoid React 19 compatibility issues.
 */
function Slot({
  children,
  className,
  disabled,
  ...props
}: {
  children?: React.ReactNode
  className?: string
  disabled?: boolean
  [key: string]: unknown
}): JSX.Element | null {
  if (!isValidElement(children)) {
    return null
  }
  const child = children as ReactElement<Record<string, unknown>>
  const childProps = child.props ?? {}
  return cloneElement(child, {
    className,
    disabled,
    ...props,
    ...childProps,
  } as Record<string, unknown>)
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', asChild = false, loading, children, disabled, ...props }, ref) => {
    const classes = cn(
      'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
      {
        'bg-primary text-primary-foreground shadow hover:bg-primary/90': variant === 'default',
        'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90': variant === 'destructive',
        'border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground': variant === 'outline',
        'bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80': variant === 'secondary',
        'hover:bg-accent hover:text-accent-foreground': variant === 'ghost',
        'text-primary underline-offset-4 hover:underline': variant === 'link',
      },
      {
        'h-9 px-4 py-2': size === 'default',
        'h-8 rounded-md px-3 text-xs': size === 'sm',
        'h-10 rounded-md px-8': size === 'lg',
        'h-9 w-9': size === 'icon',
      },
      className
    )

    if (asChild) {
      if (!isValidElement(children)) {
        return <button ref={ref} className={classes} disabled={disabled || loading} {...props}>{children}</button>
      }
      return (
        <Slot
          className={classes}
          disabled={disabled || loading}
          {...props}
        >
          {children as ReactElement}
        </Slot>
      )
    }

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={classes}
        {...props}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {children}
      </button>
    )
  }
)
Button.displayName = 'Button'

export { Button }
export type { ButtonProps }
