import { join, relative, isAbsolute } from 'node:path'
import { NO_IDE, type IdeView, type Mood } from '../../shared/ide'
import type { AnchoredStep } from '../coach/replay'
import type { EditorFeed, EditorSnapshot } from '../ports'
import { editorContext, visiblePath } from './editor-context'
import { feeling } from '../core/feeling'
import { runView } from '../core/run-view'
import type { RunSummary } from '../../shared/code'

const MOOD_WORD: Record<Mood, string> = { stuck: 'stuck', ok: 'ok', flowing: 'flowing' }
/** Feeling changes with time alone (a pause becomes "stuck"), so it is checked now and then too. */
const TICK = 15_000

/**
 * Ties the editor link to the open session: which project the coach sees, the step marked in the editor, the
 * current task and the feeling meter. Sends the panel an IdeView and the editor a short status line.
 */
export class IdeHub {
  private project: { root: string; files?: string[] } | null = null
  private step: AnchoredStep | null = null
  /** The current task, for the editor's status line ("Multiply too · 1 of 4 done"). */
  private taskLine = ''
  private timer: ReturnType<typeof setInterval> | null = null
  private lastView = ''
  /** The learner's last ▶ Run in this session (memory only, never stored). */
  private lastRun: RunSummary | null = null

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

  /** A session opened (or closed, with null): its project, current task and last marked step. */
  setSession(project: { root: string; files?: string[] } | null, taskLine = '', step: AnchoredStep | null = null): void {
    this.project = project?.root ? project : null
    this.taskLine = taskLine
    this.lastRun = null
    this.setStep(step)
  }

  setTaskLine(line: string): void {
    if (line === this.taskLine) return
    this.taskLine = line
    this.lastView = ''
    this.changed()
  }

  /** The learner's last ▶ Run in this session, for Check my answer. */
  lastRunNow(): RunSummary | null {
    return this.lastRun
  }

  setStep(step: AnchoredStep | null): void {
    this.step = step && this.project ? step : null
    if (this.step && this.project) {
      const { id, title, ghost, official } = this.step
      this.bridge.send({ type: 'anchor', stepId: id, file: join(this.project.root, this.step.path), line: this.step.line, title, ghost, official })
    } else {
      this.bridge.send({ type: 'clear' })
    }
    this.changed()
  }

  /** The learner's last ▶ Run finished (or the session changed: null). Only the last one is kept. */
  setLastRun(run: RunSummary | null): void {
    this.lastRun = run
  }

  /** Open a file of the project in the editor ("Open in editor"): absolute path, line in the coach's view. */
  open(file: string, line: number | null): void {
    this.bridge.send({ type: 'open', file, line })
  }

  /** The editor's view, and the last run, for the coach's next request (added to the newest message only). */
  context(): string {
    if (!this.project) return ''
    const snap = this.bridge.snapshot()
    const f = snap ? this.feelingOf(snap) : undefined
    return [editorContext(this.project.root, this.project.files, snap, f), runView(this.lastRun, this.now())].filter(Boolean).join('\n')
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
    if (!snap) return NO_IDE
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
      stepDone: !!this.step && snap.stepsDone.has(this.step.id),
      typed: this.step && snap.stepTyped?.stepId === this.step.id ? snap.stepTyped.n : 0
    }
  }

  /** Something changed (editor, step, task, time): update the panel and the editor's status line. */
  changed(): void {
    const view = this.view()
    const key = JSON.stringify(view)
    if (key === this.lastView) return
    this.lastView = key
    this.emit(view)
    if (view.linked) {
      const parts = [this.taskLine || 'BetterCoder', view.mood ? MOOD_WORD[view.mood] : '']
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
