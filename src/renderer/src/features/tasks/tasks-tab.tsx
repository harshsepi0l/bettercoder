import { useEffect, useState } from 'react'
import { Check, Circle, CircleCheck, CircleDot, Hourglass, LifeBuoy, Lock, MessageSquare, Pencil, Plus, Send, X } from 'lucide-react'
import type { CoachIntent } from '../../../../shared/harness'
import type { TaskCheck, TaskView } from '../../../../shared/tasks'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { SendTasks } from './send-tasks'
import { NOTICE_MS, useTasks, type ShownNotice } from './use-tasks'

type Send = (text: string, intent?: CoachIntent) => void

/**
 * The Tasks tab: every task of the session, the open one expanded with Check my answer, Get a hint and Ask about
 * this (which hands the task to the coach chat, so the learner asks in their own words). The chat stays free.
 */
export function TasksTab({ busy, onSend, onAsk }: { busy: boolean; onSend: Send; onAsk: (task: TaskView) => void }) {
  const { update } = useTasks()
  const [selected, setSelected] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  // Another session: start from its current task.
  useEffect(() => {
    setSelected(null)
  }, [update.sessionId])

  if (!update.sessionId) return null
  const tasks = update.tasks
  const current = tasks.find((t) => t.id === selected) ?? tasks.find((t) => t.status !== 'done') ?? null
  const done = tasks.filter((t) => t.status === 'done').length

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-3 px-4 py-4">
        <div className="flex items-center gap-2">
          <h2 className="flex-1 text-[15px] font-semibold text-heading">Tasks</h2>
          {tasks.length > 0 && (
            <>
              <span className="font-mono text-[11px] text-muted-foreground">
                {done}/{tasks.length} DONE
              </span>
              <Button size="xs" variant="ghost" className="h-7 text-muted-foreground" onClick={() => setSending(true)}>
                <Send />
                Send to a session…
              </Button>
            </>
          )}
        </div>
        {/* The one progress bar in the app: how many of this session's tasks are done. */}
        {tasks.length > 0 && (
          <div role="progressbar" aria-label="Tasks done" aria-valuemin={0} aria-valuemax={tasks.length} aria-valuenow={done} className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-brand-line transition-[width] duration-300" style={{ width: `${(100 * done) / tasks.length}%` }} />
          </div>
        )}

        {tasks.length === 0 ? (
          <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
            <Circle className="size-4" aria-hidden="true" />
            No tasks yet. The coach adds them as you go, or add your own.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {tasks.map((t) => {
              const open = t.id === current?.id
              return (
                <li key={t.id} className={cn('group rounded-[10px] border bg-card', open ? 'border-brand-line/60' : 'border-border')}>
                  <div className="flex h-10 items-center gap-2 pr-1.5 pl-3">
                    <button type="button" aria-expanded={open} onClick={() => setSelected(t.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                      <StatusIcon task={t} current={open} />
                      <span className={cn('min-w-0 flex-1 truncate text-[13.5px]', t.status === 'done' ? 'text-muted-foreground' : 'font-semibold text-heading')}>{t.title}</span>
                    </button>
                    {t.steps.length > 0 && (
                      <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
                        {t.steps.filter((x) => x.passed).length}/{t.steps.length}
                      </span>
                    )}
                    <ByTag by={t.by} />
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Remove ${t.title}`}
                      className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                      onClick={() => void window.tasks.remove(t.id)}
                    >
                      <X />
                    </Button>
                  </div>
                  {open && <TaskBody task={t} busy={busy} onSend={onSend} onAsk={() => onAsk(t)} />}
                </li>
              )
            })}
          </ul>
        )}

        <AddTask busy={busy} onSend={onSend} />
      </div>
      <SendTasks open={sending} onOpenChange={setSending} sessionId={update.sessionId} tasks={tasks} />
    </div>
  )
}

function StatusIcon({ task, current = false }: { task: TaskView; current?: boolean }) {
  if (task.status === 'done') return <CircleCheck className="size-4 shrink-0 text-status-done" aria-label="Done" />
  if (task.status === 'waiting') return <Hourglass className="size-4 shrink-0 text-muted-foreground" aria-label="Waiting for the coach" />
  return current ? <CircleDot className="size-4 shrink-0 text-brand-line" aria-label="Current" /> : <Circle className="size-4 shrink-0 text-muted-foreground" aria-label="Open" />
}

function ByTag({ by }: { by: TaskView['by'] }) {
  return (
    <span className={cn('shrink-0 rounded-full border px-1.5 text-[10.5px]', by === 'you' ? 'border-brand-line/50 text-brand-text' : 'border-border text-muted-foreground')}>
      {by === 'you' ? 'you' : 'coach'}
    </span>
  )
}

function CheckLine({ check }: { check: TaskCheck }) {
  const ok = check.result === 'matched'
  return (
    <div
      role="status"
      className={cn(
        'rounded-md border px-2.5 py-1.5 text-[12px] leading-snug',
        ok ? 'border-status-done/40 bg-status-done/10 text-foreground' : 'border-status-progress/40 bg-status-progress/10 text-foreground'
      )}
    >
      {check.words}
    </div>
  )
}

/** The open task: what "done" means, the sealed answer, the last check and its buttons. */
function TaskBody({ task, busy, onSend, onAsk }: { task: TaskView; busy: boolean; onSend: Send; onAsk: () => void }) {
  const ask = (
    <Button size="sm" variant="outline" className="h-7" onClick={onAsk}>
      <MessageSquare />
      Ask about this
    </Button>
  )
  return (
    <div className="flex flex-col gap-2 border-t border-divider px-3 pt-2.5 pb-3 pl-9">
      {task.status === 'waiting' ? (
        <>
          <p className="text-[12.5px] text-muted-foreground">{busy ? 'The coach is writing how to check it…' : 'The coach has not written how to check it yet.'}</p>
          <div className="flex flex-wrap gap-2">
            {!busy && (
              <Button size="sm" variant="outline" className="h-7" onClick={() => onSend('Write how to check my waiting tasks.', 'task')}>
                <Pencil />
                Ask the coach to write it
              </Button>
            )}
            {ask}
          </div>
        </>
      ) : task.steps.length > 0 ? (
        <>
          {/* Checked step by step: each step card in the chat has its own Check. */}
          <ol className="flex flex-col gap-1">
            {task.steps.map((s, i) => (
              <li key={i} className="flex items-center gap-2 text-[12.5px]">
                {s.passed ? <CircleCheck className="size-3.5 shrink-0 text-status-done" aria-label="Passed" /> : <Circle className="size-3.5 shrink-0 text-muted-foreground" aria-label="Not yet" />}
                <span className={s.passed ? 'text-muted-foreground' : 'text-foreground'}>
                  {i + 1}. {s.title}
                </span>
              </li>
            ))}
          </ol>
          <p className="text-[11.5px] text-muted-foreground">Each step is checked by running your file: press Check on its step in the chat.</p>
          <div className="flex flex-wrap gap-2 pt-0.5">
            {task.status !== 'done' && (
              <Button size="sm" className="h-7" disabled={busy} onClick={() => onSend(`Teach me the next step of “${task.title}”.`, 'next')}>
                <Check />
                Next step
              </Button>
            )}
            {ask}
          </div>
        </>
      ) : (
        <>
          <p className="text-[12.5px] leading-snug text-foreground">{task.doneWhen}</p>
          {task.status === 'done' && task.answer ? (
            <p className="text-[12px] text-status-done">
              Matched the coach's answer: <span className="font-mono">{task.answer}</span>
            </p>
          ) : (
            <p className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
              <Lock className="size-3" aria-hidden="true" />
              Answer sealed · checks your last ▶ Run
            </p>
          )}
          {task.check && task.status !== 'done' && <CheckLine check={task.check} />}
          <div className="flex flex-wrap gap-2 pt-0.5">
            {task.status !== 'done' && (
              <>
                <Button size="sm" className="h-7" onClick={() => void window.tasks.check(task.id)}>
                  <Check />
                  {task.check ? 'Check again' : 'Check my answer'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7"
                  disabled={busy}
                  onClick={() => onSend(`I'm stuck on the task “${task.title}”. Help me get there without giving me the answer.`, 'stuck')}
                >
                  <LifeBuoy />
                  Get a hint
                </Button>
              </>
            )}
            {ask}
          </div>
        </>
      )}
    </div>
  )
}

/** Add your own task; the coach then writes how to check it. */
function AddTask({ busy, onSend }: { busy: boolean; onSend: Send }) {
  const [title, setTitle] = useState('')
  const [error, setError] = useState('')

  async function add() {
    const clean = title.replace(/\s+/g, ' ').trim()
    if (!clean) return
    setError('')
    try {
      await window.tasks.add(clean)
      setTitle('')
      onSend(`Add a task: “${clean}”`, 'task')
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void add()
        }}
      >
        <label htmlFor="new-task" className="sr-only">
          New task
        </label>
        <input
          id="new-task"
          value={title}
          maxLength={60}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a task…"
          className="h-8 min-w-0 flex-1 rounded-md border border-input bg-muted px-2.5 text-[12.5px] text-heading outline-none placeholder:text-muted-foreground focus-visible:border-brand-line"
        />
        <Button type="submit" size="sm" className="h-8" disabled={!title.trim() || busy}>
          <Plus />
          Add
        </Button>
      </form>
      {error && <p className="text-[11.5px] text-status-missing">{error}</p>}
    </div>
  )
}

const NOTICE_TONE: Record<ShownNotice['kind'], { icon: React.ReactNode; bar: string; ring: string }> = {
  added: { icon: <Plus className="size-3.5 text-brand-text" />, bar: 'bg-brand-line', ring: 'bg-brand-tint' },
  matched: { icon: <Check className="size-3.5 text-status-done" />, bar: 'bg-status-done', ring: 'bg-status-done/15' },
  not_yet: { icon: <Circle className="size-3.5 text-status-progress" />, bar: 'bg-status-progress', ring: 'bg-status-progress/15' },
  no_run: { icon: <Circle className="size-3.5 text-status-progress" />, bar: 'bg-status-progress', ring: 'bg-status-progress/15' }
}

/**
 * Notifications over the top of the coach (the pane must be `relative`): the coach added a task, or a check came
 * back. They go by themselves; View opens the Tasks tab.
 */
export function TaskToasts({ onView }: { onView: () => void }) {
  const { notices, dismiss } = useTasks()
  if (notices.length === 0) return null
  return (
    <div className="absolute inset-x-3 top-2 z-20 flex flex-col gap-2">
      {notices.map((n) => {
        const tone = NOTICE_TONE[n.kind]
        const label = n.kind === 'added' ? (n.by === 'coach' ? 'Coach added a task' : 'Ready to check') : n.words
        return (
          <div key={n.key} role="status" className="overflow-hidden rounded-[10px] border border-border bg-card shadow-[0_10px_26px_rgba(0,0,0,0.5)]">
            <div className="flex items-center gap-2.5 py-2 pr-1.5 pl-3">
              <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-full', tone.ring)} aria-hidden="true">
                {tone.icon}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[11.5px] text-muted-foreground">{label}</span>
                <span className="truncate text-[13px] font-semibold text-heading">{n.title}</span>
              </span>
              <Button size="xs" variant="outline" className="h-[26px]" onClick={() => (onView(), dismiss(n.key))}>
                View
              </Button>
              <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={() => dismiss(n.key)}>
                <X />
              </Button>
            </div>
            <div className="h-0.5 bg-divider">
              <div className={cn('h-0.5', tone.bar)} style={{ animation: `bc-shrink ${NOTICE_MS}ms linear forwards` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
