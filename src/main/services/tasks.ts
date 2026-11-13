import { MAX_TASKS, type TaskCheck, type TaskNotice, type TaskView } from '../../shared/tasks'
import type { RunSummary } from '../../shared/code'
import { checkAnswer } from '../core/task-check'
import type { StoredTask } from '../ports'

/** What the coach gives set_task. */
export interface CoachTask {
  id?: string
  title: string
  doneWhen: string
  answer: string
}

/**
 * One session's tasks: added by the learner (the coach then writes their check) or by the coach, each done only when
 * Check my answer finds the coach's answer in their last ▶ Run. Kept in the session's own file; the answer never
 * reaches the panel or the coach's view until it matched.
 */
export class SessionTasks {
  constructor(
    private tasks: StoredTask[],
    private readonly save: (tasks: StoredTask[]) => void,
    private readonly emit: (notice?: TaskNotice) => void,
    private readonly now: () => number = Date.now
  ) {}

  view(): TaskView[] {
    return this.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      by: t.by,
      doneWhen: t.doneWhen,
      status: t.status,
      check: t.check,
      answer: t.status === 'done' ? t.answer : null
    }))
  }

  /** The task they are on: the first one not done. */
  current(): StoredTask | null {
    return this.tasks.find((t) => t.status !== 'done') ?? null
  }

  /** For the editor's status line: "Multiply too · 1 of 4 done". */
  statusLine(): string {
    if (this.tasks.length === 0) return ''
    const done = this.tasks.filter((t) => t.status === 'done').length
    const current = this.current()
    return current ? `${current.title} · ${done} of ${this.tasks.length} done` : `All ${this.tasks.length} tasks done`
  }

  /** The learner's own task: waiting until the coach writes how to check it. */
  addMine(title: string): StoredTask {
    const clean = cleanTitle(title)
    if (!clean) throw new Error('Name the task first.')
    if (this.tasks.length >= MAX_TASKS) throw new Error(`A session holds at most ${MAX_TASKS} tasks. Remove one first.`)
    const task: StoredTask = { id: this.nextId(), title: clean, by: 'you', doneWhen: '', answer: '', status: 'waiting', check: null, createdAt: this.now() }
    this.tasks = [...this.tasks, task]
    this.changed()
    return task
  }

  /** Tasks from the old progress meter: the coach's, waiting for it to write their checks. Once, on a session's first open. */
  importLegacy(titles: readonly string[]): void {
    const now = this.now()
    for (const raw of titles) {
      const title = cleanTitle(raw)
      if (!title || this.tasks.length >= MAX_TASKS || this.tasks.some((t) => t.title.toLowerCase() === title.toLowerCase())) continue
      this.tasks = [...this.tasks, { id: this.nextId(), title, by: 'coach', doneWhen: '', answer: '', status: 'waiting', check: null, createdAt: now }]
    }
    this.changed()
  }

  /** The coach adds a task, or (with an id) writes or changes one's check. */
  coachSet(input: CoachTask): StoredTask {
    const title = cleanTitle(input.title)
    const doneWhen = input.doneWhen.replace(/\s+/g, ' ').trim()
    const answer = input.answer.trim()
    if (!title || !doneWhen || !answer) throw new Error('A task needs a title, done_when and your answer.')
    const existing = input.id ? this.tasks.find((t) => t.id === input.id) : undefined
    if (input.id && !existing) throw new Error(`There is no task ${input.id}. Leave id out to add a new one.`)
    if (existing) {
      const changedCheck = existing.answer !== answer || existing.doneWhen !== doneWhen
      const next: StoredTask = {
        ...existing,
        title,
        doneWhen,
        answer,
        // A new check opens the task again; the same check keeps a done task done.
        status: existing.status === 'done' && !changedCheck ? 'done' : 'open',
        check: changedCheck ? null : existing.check
      }
      this.tasks = this.tasks.map((t) => (t.id === existing.id ? next : t))
      this.changed(existing.status === 'waiting' ? { kind: 'added', taskId: next.id, title: next.title, by: next.by, words: 'The coach wrote how to check it.' } : undefined)
      return next
    }
    const same = this.tasks.find((t) => t.title.toLowerCase() === title.toLowerCase())
    if (same) return this.coachSet({ ...input, id: same.id })
    if (this.tasks.length >= MAX_TASKS) throw new Error(`The learner already has ${MAX_TASKS} tasks. Update one (with its id) instead.`)
    const task: StoredTask = { id: this.nextId(), title, by: 'coach', doneWhen, answer, status: 'open', check: null, createdAt: this.now() }
    this.tasks = [...this.tasks, task]
    this.changed({ kind: 'added', taskId: task.id, title: task.title, by: 'coach', words: 'Coach added a task' })
    return task
  }

  remove(id: string): void {
    const before = this.tasks.length
    this.tasks = this.tasks.filter((t) => t.id !== id)
    if (this.tasks.length !== before) this.changed()
  }

  /** Check my answer: their last run against the coach's answer. */
  check(id: string, run: RunSummary | null): TaskCheck {
    const task = this.tasks.find((t) => t.id === id)
    if (!task) throw new Error('That task is gone.')
    if (task.status === 'waiting') throw new Error('The coach has not written how to check this one yet.')
    const check = checkAnswer(task.answer, run, this.now())
    const next: StoredTask = { ...task, check, status: check.result === 'matched' ? 'done' : task.status }
    this.tasks = this.tasks.map((t) => (t.id === id ? next : t))
    this.changed({ kind: check.result, taskId: id, title: task.title, by: task.by, words: check.words })
    return check
  }

  /** Copies for another session: fresh (not done, no checks), answers kept. */
  copies(ids: readonly string[]): StoredTask[] {
    const now = this.now()
    return this.tasks
      .filter((t) => ids.includes(t.id))
      .map((t) => ({ ...t, status: t.doneWhen && t.answer ? 'open' : 'waiting', check: null, createdAt: now }) as StoredTask)
  }

  /**
   * What the coach sees of the tasks, on the newest message only (never stored): titles, states and checks, never
   * the answers.
   */
  forCoach(): string {
    if (this.tasks.length === 0) return '[BetterCoder tasks: none yet. Once you know what they must build, add their tasks with set_task.]'
    const lines = this.tasks.map((t) => {
      const by = t.by === 'you' ? ' (added by the learner)' : ''
      if (t.status === 'waiting') return `- ${t.id} ${t.title}${by}: WAITING for you. Call set_task with id ${t.id}, done_when and your answer.`
      const last = t.check ? ` Last check: ${t.check.words}` : ''
      return `- ${t.id} ${t.title}${by}: ${t.status === 'done' ? 'done' : 'open'}. Done when: ${t.doneWhen}.${last}`
    })
    return `[BetterCoder tasks: the learner's tasks, in order. A task is done only when their run prints your answer.\n${lines.join('\n')}\nEnd of tasks.]`
  }

  /** Tasks sent from another session, after these. */
  append(more: readonly StoredTask[]): void {
    for (const t of more) {
      if (this.tasks.length >= MAX_TASKS) break
      if (this.tasks.some((x) => x.title.toLowerCase() === t.title.toLowerCase())) continue
      this.tasks = [...this.tasks, { ...t, id: this.nextId() }]
    }
    this.changed()
  }

  all(): readonly StoredTask[] {
    return this.tasks
  }

  private nextId(): string {
    const n = this.tasks.reduce((max, t) => Math.max(max, Number(t.id.slice(1)) || 0), 0)
    return `t${n + 1}`
  }

  private changed(notice?: TaskNotice): void {
    this.save(this.tasks)
    this.emit(notice)
  }
}

function cleanTitle(title: string): string {
  const t = title.replace(/\s+/g, ' ').trim()
  return t.length > 60 ? `${t.slice(0, 59).trimEnd()}…` : t
}
