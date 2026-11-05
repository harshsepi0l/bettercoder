import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface Request {
  title: string
  description: string
  confirmLabel: string
  onConfirm: () => void | Promise<void>
}

const ConfirmContext = createContext<(r: Request) => void>(() => {})

/** One app-wide confirm dialog for deleting things. */
export function ConfirmDeleteProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null)
  const [working, setWorking] = useState(false)
  const ask = useCallback((r: Request) => setRequest(r), [])

  async function confirm() {
    if (!request) return
    setWorking(true)
    try {
      await request.onConfirm()
    } finally {
      setWorking(false)
      setRequest(null)
    }
  }

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      <Dialog open={request !== null} onOpenChange={(open) => !open && !working && setRequest(null)}>
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="text-heading">{request?.title}</DialogTitle>
            <DialogDescription>{request?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRequest(null)} disabled={working}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirm} disabled={working} autoFocus>
              <Trash2 />
              {request?.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  )
}

export function useConfirmDelete() {
  return useContext(ConfirmContext)
}
