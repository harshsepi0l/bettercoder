import { useEffect, useState } from 'react'
import { ArrowRight, FolderOpen, LifeBuoy } from 'lucide-react'
import type { CoachIntent } from '../../../../shared/harness'
import { NO_IDE, type IdeView } from '../../../../shared/ide'
import { Button } from '@/components/ui/button'

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

/**
 * Buttons over the chat, only when one applies: Get a hint when the editor looks stuck, Next step when they typed out
 * the step, and opening this project's folder when VS Code is on another. How it is going is never shown as a word or
 * a bar (the learner removed that, 2026-11-13): only a task's progress is.
 */
export function CoachActions({ busy, onSend }: { busy: boolean; onSend: (text: string, intent?: CoachIntent) => void }) {
  const ide = useIde()
  if (!ide.linked) return null
  const hint = !busy && ide.mood === 'stuck'
  const next = !busy && ide.stepDone && ide.mood !== 'stuck'
  if (!ide.otherFolder && !hint && !next) return null
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 border-b border-divider bg-chrome px-3 py-1.5">
      {ide.otherFolder && (
        <Button size="xs" variant="outline" className="h-6" onClick={() => void window.ide.openFolder()}>
          <FolderOpen />
          Open {ide.otherFolder.split('/').pop()}
        </Button>
      )}
      {hint && (
        <Button size="xs" className="h-6" onClick={() => onSend("I'm stuck. Help me work out what's going on, without giving me the answer.", 'stuck')}>
          <LifeBuoy />
          Get a hint
        </Button>
      )}
      {next && (
        <Button size="xs" className="h-6" onClick={() => onSend('I wrote that step. What next?', 'next')}>
          <ArrowRight />
          Next step
        </Button>
      )}
    </div>
  )
}
