import type { ReactNode } from 'react'
import { Dialog } from './dialog'
import { Button } from './button'

interface AlertDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'default' | 'destructive'
  onConfirm: () => void
  onCancel?: () => void
  loading?: boolean
}

export function AlertDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
  loading,
}: AlertDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title}>
      <p className="text-sm text-muted-foreground mb-4">{description}</p>
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          onClick={() => {
            onCancel?.()
            onOpenChange(false)
          }}
          disabled={loading}
        >
          {cancelLabel}
        </Button>
        <Button
          variant={variant === 'destructive' ? 'destructive' : 'default'}
          onClick={onConfirm}
          loading={loading}
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  )
}

interface AlertDialogProviderProps {
  children: ReactNode
}

export function AlertDialogProvider({ children }: AlertDialogProviderProps) {
  return <>{children}</>
}
