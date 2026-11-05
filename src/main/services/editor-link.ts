import { join, relative, isAbsolute } from 'node:path'
import { NO_IDE, type IdeView, type Mood, type TaskProgress } from '../../shared/ide'
import type { AnchoredStep } from '../coach/replay'
import type { EditorFeed, EditorSnapshot } from '../ports'
import { editorContext, visiblePath } from './editor-context'
import { feeling } from '../core/feeling'

const MOOD_WORD: Record<Mood, string> = { stuck: 'stuck', ok: 'ok', flowing: 'flowing' }
/** Feeling changes with time alone (a pause becomes "stuck"), so it is checked now and then too. */
const TICK = 15_000

/**
 * Ties the editor link to the open session: which project the coach sees, the step marked in the editor, the
 * progress meter and the feeling meter. Sends the panel an IdeView and the editor a short status line.
 */
export class IdeHub {
  private project: { root: string; files?: string[] } | null = null
  private step: AnchoredStep | null = null
  private tasks: TaskProgress[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private lastView = ''

  constructor(
    private readonly bridge: EditorFeed,
    private readonly emit: (view: IdeView) => void,
    private readonly now: () => number = Date.now
  ) {}

  start(): void {
    this.timer ??= setInterval(() => this.changed(), TICK)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** A session opened (or closed, with null): its project, stored progress and last marked step. */
  setSession(project: { root: string; files?: string[] } | null, tasks: TaskProgress[] = [], step: AnchoredStep | null = null): void {
    this.project = project?.root ? project : null
    this.tasks = tasks
    this.setStep(step)
  }

  setProgress(tasks: TaskProgress[]): void {
    this.tasks = tasks
    this.changed()
  }

  setStep(step: AnchoredStep | null): void {
    this.step = step && this.project ? step : null
    if (this.step && this.project) {
      this.bridge.send({ type: 'anchor', stepId: this.step.id, file: join(this.project.root, this.step.path), line: this.step.line, ghost: this.step.ghost })
    } else {
      this.bridge.send({ type: 'clear' })
    }
    this.changed()
  }

  /** The editor's view for the coach's next request. */
  context(): string {
    if (!this.project) return ''
    const snap = this.bridge.snapshot()
    const f = snap ? this.feelingOf(snap) : undefined
    return editorContext(this.project.root, this.project.files, snap, f)
  }

  /** The linked editor's name, or null when none is connected. */
  ideName(): string | null {
    return this.bridge.snapshot()?.ide ?? null
  }

  /** The editor's folder, when it is not the open project. */
  otherFolder(): string | null {
    const snap = this.bridge.snapshot()
    if (!snap) return null
    const folder = snap.folders[0] ?? null
    if (!folder) return null
    if (this.project && this.inside(this.project.root, snap.file ?? folder)) return null
    return folder
  }

  view(): IdeView {
    const snap = this.bridge.snapshot()
    if (!snap) return { ...NO_IDE, tasks: this.tasks }
    const rel = this.project ? visiblePath(this.project.root, this.project.files, snap.file) : null
    const f = this.feelingOf(snap)
    return {
      linked: true,
      ide: snap.ide,
      otherFolder: this.otherFolder(),
      file: rel,
      line: rel ? snap.line : null,
      mood: rel ? f.mood : null,
      why: rel ? f.why : '',
      tasks: this.tasks,
      stepDone: !!this.step && snap.stepsDone.has(this.step.id)
    }
  }

  /** Something changed (editor, step, progress, time): update the panel and the editor's status line. */
  changed(): void {
    const view = this.view()
    const key = JSON.stringify(view)
    if (key === this.lastView) return
    this.lastView = key
    this.emit(view)
    if (view.linked) {
      const current = view.tasks.find((t) => t.percent < 100) ?? view.tasks.at(-1)
      const parts = [current ? `${current.title} ${current.percent}%` : 'BetterCoder', view.mood ? MOOD_WORD[view.mood] : '']
      this.bridge.send({ type: 'status', text: parts.filter(Boolean).join(' · '), tooltip: view.why || 'BetterCoder is watching' })
    }
  }

  private feelingOf(snap: EditorSnapshot) {
    const stepOpen = !!this.step && !snap.stepsDone.has(this.step.id)
    return feeling({ now: this.now(), lastEditAt: snap.lastEditAt, errorsSince: snap.errors?.since ?? null, stepOpen })
  }

  private inside(root: string, path: string): boolean {
    const rel = relative(root, path)
    return !rel.startsWith('..') && !isAbsolute(rel)
  }
}
