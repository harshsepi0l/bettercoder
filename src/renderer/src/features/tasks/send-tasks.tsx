import { useEffect, useState } from 'react'
import type { TaskView } from '../../../../shared/tasks'
import type { SessionSummary } from '../../../../shared/workspace'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

/**
 * Send tasks to another session of this project (a new one, or one it has). Each keeps its check and the coach's
 * sealed answer and starts fresh there. Done ones start unticked.
 */
export function SendTasks({
  open,
  onOpenChange,
  sessionId,
  tasks
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionId: string | null
  tasks: TaskView[]
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [to, setTo] = useState<'new' | 'session'>('new')
  const [others, setOthers] = useState<SessionSummary[]>([])
  const [other, setOther] = useState<string>('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!open) return
    setPicked(new Set(tasks.filter((t) => t.status !== 'done').map((t) => t.id)))
    setTo('new')
    setError('')
    let live = true
    void window.workspace.list().then((projects) => {
      if (!live) return
      const mine = projects.find((p) => p.sessions.some((s) => s.id === sessionId))
      const list = (mine?.sessions ?? []).filter((s) => s.id !== sessionId)
      setOthers(list)
      setOther(list[0]?.id ?? '')
    })
    return () => {
      live = false
    }
    // Only when it opens: ticking boxes must not be reset by a task update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function toggle(id: string) {
    setPicked((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function send() {
    setSending(true)
    setError('')
    try {
      await window.tasks.send([...picked], to === 'new' ? { kind: 'new' } : { kind: 'session', sessionId: other })
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
    } finally {
      setSending(false)
    }
  }

  const n = picked.size
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Send tasks</DialogTitle>
          <DialogDescription>Each one keeps its check and the coach's sealed answer, and starts fresh.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col overflow-hidden rounded-md border border-border">
          {tasks.map((t) => (
            <label key={t.id} className="flex h-9 items-center gap-2.5 border-b border-divider px-3 text-[13px] last:border-b-0">
              <input type="checkbox" checked={picked.has(t.id)} onChange={() => toggle(t.id)} className="size-3.5 accent-brand-line" />
              <span className={cn('min-w-0 flex-1 truncate', t.status === 'done' ? 'text-muted-foreground' : 'text-heading')}>{t.title}</span>
              {t.status === 'done' && <span className="text-[11px] text-status-done">done</span>}
              {t.by === 'you' && <span className="rounded-full border border-brand-line/50 px-1.5 text-[10.5px] text-brand-text">you</span>}
            </label>
          ))}
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 font-mono text-[10px] tracking-wider text-muted-foreground">SEND TO</legend>
          <label className={cn('flex items-center gap-2.5 rounded-md border px-3 py-2.5 text-[13px]', to === 'new' ? 'border-brand-line bg-brand-tint text-heading' : 'border-border')}>
            <input type="radio" name="send-to" checked={to === 'new'} onChange={() => setTo('new')} className="accent-brand-line" />A new session
          </label>
          <div className={cn('flex flex-col gap-2 rounded-md border px-3 py-2.5 text-[13px]', to === 'session' ? 'border-brand-line bg-brand-tint text-heading' : 'border-border')}>
            <label className="flex items-center gap-2.5">
              <input type="radio" name="send-to" checked={to === 'session'} disabled={others.length === 0} onChange={() => setTo('session')} className="accent-brand-line" />
              A session I have{others.length === 0 && <span className="text-muted-foreground"> (none yet)</span>}
            </label>
            {to === 'session' && others.length > 0 && (
              <Select value={other} onValueChange={setOther}>
                <SelectTrigger size="sm" className="w-full bg-muted text-[12.5px]" aria-label="Session">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {others.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </fieldset>

        {error && <p className="text-[12px] text-status-missing">{error}</p>}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={n === 0 || sending || (to === 'session' && !other)} onClick={() => void send()}>
            {to === 'new' ? `Start with ${n} task${n === 1 ? '' : 's'}` : `Send ${n} task${n === 1 ? '' : 's'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
