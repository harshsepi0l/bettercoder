import { useState } from 'react'
import { ArrowRight, CircleCheck, CircleDashed, CircleX, Play } from 'lucide-react'
import type { Card } from '../../../../shared/cards'
import { expectWords, stepKey } from '../../../../shared/step-checks'
import { Button } from '@/components/ui/button'
import { useTasksUpdate } from '@/features/tasks/use-tasks'
import { cn } from '@/lib/utils'

type StepCardData = Extract<Card, { kind: 'step' }>

/**
 * A checked step: what Check will test, in the app's words, and the Check button. Check runs their file once per
 * check with its inputs typed in (VS Code shows it in its ▶ Check terminal), and the app grades each line itself. When
 * every line passes, Next step asks the coach for the next one. A task's step shows where it is in the task.
 */
export function StepChecks({ card, onNext }: { card: StepCardData; onNext: (text: string) => void }) {
  const update = useTasksUpdate()
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const checks = card.checks ?? []
  const last = update.steps?.[stepKey(card.title, checks)]
  const task = card.of ? update.tasks.find((t) => t.id === card.of!.taskId) : undefined
  const total = task?.steps.length ?? 0
  const passedSteps = task?.steps.filter((s) => s.passed).length ?? 0
  const lines = checks.flatMap((c) => c.expect.map((e) => expectWords(c, e)))

  async function check() {
    setRunning(true)
    setError('')
    try {
      await window.tasks.checkStep(card.title, checks, card.anchor?.path ?? null, card.of ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '') : String(e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      {card.of && total > 0 && (
        <div className="flex items-center gap-2">
          <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
            STEP {card.of.step} OF {total} · {task!.title}
          </span>
          <div role="progressbar" aria-label="Steps passed in this task" aria-valuemin={0} aria-valuemax={total} aria-valuenow={passedSteps} className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-brand-line transition-[width] duration-300" style={{ width: `${(100 * passedSteps) / total}%` }} />
          </div>
        </div>
      )}
      <ul className="flex flex-col gap-1">
        {lines.map((line, i) => {
          const r = last?.results[i]
          const Icon = !r ? CircleDashed : r.pass ? CircleCheck : CircleX
          return (
            <li key={i} className="flex items-start gap-2 text-[12.5px]">
              <Icon className={cn('mt-0.5 size-3.5 shrink-0', !r ? 'text-muted-foreground' : r.pass ? 'text-status-done' : 'text-status-missing')} aria-label={!r ? 'Not checked yet' : r.pass ? 'Passed' : 'Not yet'} />
              <span className="min-w-0 flex-1">
                {line}
                {r && !r.pass && r.why && <span className="block text-[12px] text-muted-foreground">{r.why}</span>}
              </span>
            </li>
          )
        })}
      </ul>
      {error && <p className="text-[12px] text-status-missing">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={last?.passed ? 'outline' : 'default'} className="h-7" disabled={running} onClick={() => void check()}>
          <Play />
          {running ? 'Checking…' : last ? 'Check again' : 'Check'}
        </Button>
        {last?.passed && (
          <Button size="sm" className="h-7" onClick={() => onNext('I passed this step. What next?')}>
            Passed · Next step
            <ArrowRight />
          </Button>
        )}
        <span className="text-[11px] text-muted-foreground">Runs your file with these inputs; the app checks it, not the coach.</span>
      </div>
    </div>
  )
}
