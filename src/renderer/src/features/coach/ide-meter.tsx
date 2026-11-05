import { useEffect, useState } from 'react'
import { ArrowRight, Eye, FolderOpen, LifeBuoy } from 'lucide-react'
import type { CoachIntent } from '../../../../shared/harness'
import { NO_IDE, type IdeView, type Mood } from '../../../../shared/ide'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** The editor link as the panel sees it, kept current by the main process. */
export function useIde(): IdeView {
  const [view, setView] = useState<IdeView>(NO_IDE)
  useEffect(() => {
    let live = true
    void window.ide.getState().then((v) => live && setView(v))
    const off = window.ide.onState(setView)
    return () => {
      live = false
      off()
    }
  }, [])
  return view
}

const ZONES: Array<{ mood: Mood; label: string; on: string }> = [
  { mood: 'stuck', label: 'Stuck', on: 'bg-status-missing text-chrome' },
  { mood: 'ok', label: 'OK', on: 'bg-status-progress text-chrome' },
  { mood: 'flowing', label: 'Flowing', on: 'bg-status-done text-chrome' }
]

/**
 * Two meters over the chat: how far their code is on each task (from the coach), and how it is going (from their
 * editor). Buttons appear when it looks like they need the coach; they send the same intents as the composer.
 */
export function IdeMeter({ busy, onSend }: { busy: boolean; onSend: (text: string, intent?: CoachIntent) => void }) {
  const ide = useIde()
  if (!ide.linked && ide.tasks.length === 0) return null
  const done = ide.tasks.filter((t) => t.percent >= 100).length
  const current = ide.tasks.find((t) => t.percent < 100)

  return (
    <section aria-label="Progress" className="flex shrink-0 flex-col gap-3 border-b border-divider bg-chrome px-3.5 py-3">
      {ide.otherFolder && (
        <div className="flex items-center gap-2 text-[12px]">
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {ide.ide} has <span className="text-heading">{ide.otherFolder.split('/').pop()}</span> open
          </span>
          <Button size="xs" variant="outline" className="h-7" onClick={() => void window.ide.openFolder()}>
            <FolderOpen />
            Open it here
          </Button>
        </div>
      )}

      {ide.tasks.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between text-[11.5px]">
            <span className="text-muted-foreground">Progress</span>
            <span className="text-heading">
              {done} of {ide.tasks.length} done
            </span>
          </div>
          <div className="flex gap-1">
            {ide.tasks.map((t, i) => (
              <div key={i} title={`${t.title}: ${t.percent}%`} className="h-2 flex-1 overflow-hidden rounded-full bg-divider">
                <div className="h-2 bg-brand-line transition-[width]" style={{ width: `${t.percent}%` }} />
              </div>
            ))}
          </div>
          <span className="truncate text-[11.5px]">{current ? `Now: ${current.title}` : 'All done'}</span>
        </div>
      )}

      {ide.mood && (
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between text-[11.5px] text-muted-foreground">
            <span>Feeling</span>
            <span>{ide.why}</span>
          </div>
          <div className="flex gap-1 text-center text-[11.5px]">
            {ZONES.map((z) => (
              <span
                key={z.mood}
                className={cn('flex-1 rounded-md py-1', z.mood === ide.mood ? cn(z.on, 'font-semibold') : 'bg-muted text-muted-foreground')}
              >
                {z.label}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {ide.linked && (
          <span className="flex min-w-0 items-center gap-1.5 rounded-full border bg-muted px-2.5 py-0.5 text-[11px] text-muted-foreground">
            <Eye className="size-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{ide.file ? `Watching ${ide.file.split('/').pop()} · line ${ide.line}` : `${ide.ide} linked`}</span>
          </span>
        )}
        {!busy && ide.mood === 'stuck' && (
          <Button size="xs" className="h-7" onClick={() => onSend("I'm stuck. Help me work out what's going on, without giving me the answer.", 'stuck')}>
            <LifeBuoy />
            Get a hint
          </Button>
        )}
        {!busy && ide.stepDone && ide.mood !== 'stuck' && (
          <Button size="xs" className="h-7" onClick={() => onSend('I wrote that step. What next?', 'next')}>
            <ArrowRight />
            Next step
          </Button>
        )}
      </div>
    </section>
  )
}
