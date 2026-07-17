import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Download, FileSpreadsheet, FileText, FileDown } from 'lucide-react'

interface ExportMenuProps {
  onExportCSV: () => void
  onExportExcel: () => void
  onExportPDF: () => void
}

export function ExportMenu({ onExportCSV, onExportExcel, onExportPDF }: ExportMenuProps) {
  const [open, setOpen] = useState(false)

  const items = [
    { label: 'CSV', icon: FileDown, action: onExportCSV },
    { label: 'Excel (.xlsx)', icon: FileSpreadsheet, action: onExportExcel },
    { label: 'PDF', icon: FileText, action: onExportPDF },
  ]

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Download className="mr-2 h-4 w-4" />Export
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title="Export As">
        <div className="space-y-2">
          {items.map((item) => (
            <button
              key={item.label}
              onClick={() => { item.action(); setOpen(false) }}
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
