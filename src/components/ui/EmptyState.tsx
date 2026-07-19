import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Inbox } from 'lucide-react'

interface EmptyStateProps {
  title: string
  description: string
  action?: { label: string; onClick: () => void }
  icon?: ReactNode
}

export function EmptyState({ title, description, action, icon }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <div className="text-muted-foreground/50">{icon ?? <Inbox className="h-12 w-12" />}</div>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      {action && <Button onClick={action.onClick}>{action.label}</Button>}
    </div>
  )
}
