import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Download, FileSpreadsheet, FileText, FileDown } from 'lucide-react'
import { toast } from 'sonner'

interface ExportMenuProps {
  label?: string
  onExportCSV: () => Promise<void>
  onExportExcel: () => Promise<void>
  onExportPDF: () => Promise<void>
}

export function ExportMenu({ label = 'Export', onExportCSV, onExportExcel, onExportPDF }: ExportMenuProps) {
  const [open, setOpen] = useState(false)

  const items = [
    { label: 'CSV', icon: FileDown, action: onExportCSV },
    { label: 'Excel (.xlsx)', icon: FileSpreadsheet, action: onExportExcel },
    { label: 'PDF', icon: FileText, action: onExportPDF },
  ]

  const handleAction = async (item: { label: string; icon: typeof FileDown; action: () => Promise<void> }) => {
    setOpen(false)
    try {
      await item.action()
      toast.success(`Report exported as ${item.label.toUpperCase()}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed')
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Download className="mr-2 h-4 w-4" />{label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title="Export As">
        <div className="space-y-2">
          {items.map((item) => (
            <button
              key={item.label}
              onClick={() => handleAction(item)}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm hover:bg-accent transition-colors"
            >
              <item.icon className="h-4 w-4 text-muted-foreground" />
              {item.label}
            </button>
          ))}
        </div>
      </Dialog>
    </>
  )
}
