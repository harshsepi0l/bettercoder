import { join } from 'node:path'
import { SandboxError } from '../core/paths'
import { ToolMissingError, type RunPlan } from '../core/runners'
import type { FileProblems, RunSummary } from '../../shared/code'
import type { IdeDiagnostic } from '../../shared/ide'
import type { TerminalSpawn } from '../ports'
import { plainOutput, type TerminalHub } from '../services/terminals'
import { withoutEcho } from '../core/step-check'

/**
 * ▶ Run, without Electron (so it is tested): the open session's file runs for real in the project folder with the
 * command for its language, in the app's own terminal (so the coach sees the last run). The last run's problems are
 * kept per file and handed on as underlines. Editing and saving are VS Code's; nothing here writes into the project.
 */

export interface CodeProject {
  sessionId: string
  root: string
  files?: string[]
}

export interface CodeAreaDeps {
  project: () => CodeProject | null
  /** Throws unless the file is one of theirs: inside the project, one of the files they opened, not a secret file. */
  ensureTheirs: (root: string, rel: string, allowed?: ReadonlySet<string>) => Promise<void>
  /** The terminals, or null with the reason they can't work here. */
  terminals: () => { hub: TerminalHub } | { problem: string }
  /** How ▶ Run runs this file (adapters/toolchain.ts), with the terminal's environment. */
  plan: (root: string, rel: string, env: Record<string, string>) => Promise<RunPlan>
  env: (root: string) => Promise<Record<string, string>>
  problems: (p: FileProblems) => void
  /** The last run changed (for the coach's view of it). */
  lastRun?: (run: RunSummary | null) => void
}

export class CodeArea {
  private runProblems = new Map<string, IdeDiagnostic[]>()
  private sessionId: string | null = null

  constructor(private readonly deps: CodeAreaDeps) {}

  /** Follow the runs of these terminals (once they are ready): their problems and the last run. */
  watchRuns(hub: TerminalHub): void {
    hub.onRunEnd((sessionId, run, problems) => {
      if (sessionId !== this.deps.project()?.sessionId) return
      // A step's Check is not their run: it never replaces their last run or its underlines.
      if (hub.isCheck(run.id)) return
      // The last run's problems replace the previous run's.
      const before = [...this.runProblems.keys()]
      this.runProblems.clear()
      if (problems) this.runProblems.set(problems.path, problems.items)
      for (const path of new Set([...before, ...(problems ? [problems.path] : [])])) this.publish(path)
      this.deps.lastRun?.(run)
    })
  }

  /** Another session opened (or none): its problems and last run start empty. */
  sessionChanged(sessionId: string | null): void {
    this.sessionId = sessionId
    this.runProblems.clear()
    this.deps.lastRun?.(null)
  }

  /**
   * ▶ Run: the file, for real, in the project folder, with the command for its language (core/runners.ts). A missing
   * tool throws ToolMissingError with its official install page.
   */
  async run(path: string, cols: number, rows: number, opts: { check?: boolean } = {}): Promise<RunSummary> {
    const p = this.deps.project()
    if (!p) throw new SandboxError('Open a folder or files first.')
    if (!p.root) throw new SandboxError('Link your project folder first.')
    if (this.sessionId !== p.sessionId) this.sessionChanged(p.sessionId)
    const t = this.deps.terminals()
    if ('problem' in t) throw new SandboxError(`The terminal is not available here: ${t.problem}`)
    await this.deps.ensureTheirs(p.root, path, p.files ? new Set(p.files) : undefined)
    const env = await this.deps.env(p.root)
    const plan = await this.deps.plan(p.root, path, env)
    if (plan.kind === 'missing') throw new ToolMissingError(plan.message, plan.install)
    if (plan.kind === 'unsupported') throw new SandboxError(plan.message)
    const spawn: TerminalSpawn = { command: plan.command, args: plan.args, cwd: plan.cwd ? join(p.root, plan.cwd) : p.root, env, cols, rows }
    return t.hub.startRun(p.sessionId, p.root, path, spawn, opts)
  }

  /**
   * A step's Check: the file runs as with ▶ Run, the check's inputs are typed in one line at a time, and it is stopped
   * once it has printed nothing for `quietMs` after it started printing (waiting for more input, or stuck), or after
   * `limitMs` in all. Building (C#, Java, Kotlin, Swift) can take a while before anything prints, so the quiet clock
   * only starts with the first output. Resolves with the finished run.
   */
  async runWith(
    path: string,
    inputs: readonly string[],
    onStart?: (run: RunSummary) => void,
    { quietMs = 8_000, limitMs = 90_000, tickMs = 250 }: { quietMs?: number; limitMs?: number; tickMs?: number } = {}
  ): Promise<{ run: RunSummary; timedOut: boolean }> {
    const started = await this.run(path, 100, 30, { check: true })
    const h = this.hubFor()
    if (!h) throw new SandboxError('The terminal is not available here.')
    const ended = new Promise<RunSummary>((resolve) => {
      const off = h.hub.onRunEnd((_s, run) => {
        if (run.id !== started.id) return
        off()
        resolve(run)
      })
    })
    // The terminal echoes what is typed at once, before anything is built: only output beyond that echo counts.
    let lastOutput: number | null = null
    let seen = ''
    const offData = h.hub.onEvent((e) => {
      if (e.type !== 'data' || e.id !== started.id) return
      if (lastOutput === null) {
        seen += e.data
        if (withoutEcho(plainOutput(seen), inputs).trim() === '') return
      }
      lastOutput = Date.now()
    })
    onStart?.(started)
    for (const line of inputs) h.hub.input(h.sessionId, started.id, `${line}\r`)
    let timedOut = false
    const begun = Date.now()
    const timer = setInterval(() => {
      const now = Date.now()
      if (now - begun > limitMs || (lastOutput !== null && now - lastOutput > quietMs)) {
        timedOut = true
        clearInterval(timer)
        h.hub.stop(h.sessionId, started.id)
      }
    }, tickMs)
    try {
      return { run: await ended, timedOut }
    } finally {
      clearInterval(timer)
      offData()
    }
  }

  private hubFor(): { hub: TerminalHub; sessionId: string } | null {
    const p = this.deps.project()
    const t = this.deps.terminals()
    return p && 'hub' in t ? { hub: t.hub, sessionId: p.sessionId } : null
  }

  input(id: string, data: string): void {
    const h = this.hubFor()
    h?.hub.input(h.sessionId, id, data)
  }

  resize(id: string, cols: number, rows: number): void {
    const h = this.hubFor()
    h?.hub.resize(h.sessionId, id, cols, rows)
  }

  stop(id: string): void {
    const h = this.hubFor()
    h?.hub.stop(h.sessionId, id)
  }

  lastRun(): RunSummary | null {
    const h = this.hubFor()
    return h ? h.hub.lastRun(h.sessionId) : null
  }

  private publish(path: string): void {
    this.deps.problems({ path, items: (this.runProblems.get(path) ?? []).map((d) => ({ ...d, source: 'run' as const })) })
  }
}
