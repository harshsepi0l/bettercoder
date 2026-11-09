import type { RunSummary, TerminalEvent } from '../../shared/code'
import type { IdeDiagnostic } from '../../shared/ide'
import type { Terminals, TerminalSpawn } from '../ports'
import { runErrorInWords } from '../core/error-words'
import { parseRunError } from '../core/run-errors'
import { languageOf } from '../core/runners'

/** At most this much of a run's output is kept (the newest part). */
export const MAX_RUN_OUTPUT = 1024 * 1024

interface Term {
  id: string
  sessionId: string
  kind: 'run'
  root: string
  run?: RunSummary
}

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[@-Z\\-_]/g

/** Terminal output as plain text: colour and cursor codes removed, \r\n as \n, bare \r (progress bars) kept last. */
export function plainOutput(raw: string): string {
  return raw
    .replace(ANSI, '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.split('\r').at(-1) ?? '')
    .join('\n')
}

/**
 * ▶ Run's terminals, per session. Only the learner's keystrokes reach one (typed into VS Code's "▶ Run" terminal; the
 * coach has no way in: this is not in CoachPorts). Each keeps its output, exit status and error with its plain-words
 * line; the coach may see only the last run (services/editor-link.ts). VS Code's own terminals are never seen.
 */
export class TerminalHub {
  private terms = new Map<string, Term>()
  private last = new Map<string, RunSummary>()
  private rawOutput = new Map<string, string>()
  private listeners = new Set<(e: TerminalEvent) => void>()
  private runEndListeners = new Set<(sessionId: string, run: RunSummary, problems: { path: string; items: IdeDiagnostic[] } | null) => void>()

  constructor(
    private readonly terminals: Terminals,
    private readonly now: () => number = Date.now
  ) {
    terminals.onData((id, data) => {
      const t = this.terms.get(id)
      if (!t) return
      if (t.kind === 'run') {
        const prev = this.rawOutput.get(id) ?? ''
        const next = prev + data
        this.rawOutput.set(id, next.length > MAX_RUN_OUTPUT ? next.slice(next.length - MAX_RUN_OUTPUT) : next)
      }
      this.emit({ type: 'data', id, data })
    })
    terminals.onExit((id, exitCode) => {
      const t = this.terms.get(id)
      if (!t) return
      this.emit({ type: 'exit', id, exitCode })
      if (t.kind === 'run' && t.run) this.finishRun(t, exitCode)
    })
  }

  onEvent(listener: (e: TerminalEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** A run ended: its summary, and the problems to underline (null when it ended without an error in their code). */
  onRunEnd(listener: (sessionId: string, run: RunSummary, problems: { path: string; items: IdeDiagnostic[] } | null) => void): () => void {
    this.runEndListeners.add(listener)
    return () => this.runEndListeners.delete(listener)
  }

  startRun(sessionId: string, root: string, path: string, spawn: TerminalSpawn): RunSummary {
    const id = this.terminals.spawn(spawn)
    const run: RunSummary = { id, path, startedAt: this.now(), endedAt: null, exitCode: null, stopped: false, output: '', error: null, words: null }
    this.terms.set(id, { id, sessionId, kind: 'run', root, run })
    this.rawOutput.set(id, '')
    this.emit({ type: 'run', run })
    return run
  }

  /** Is this terminal one of this session's? (Every call from the window is checked.) */
  owns(sessionId: string, id: string): boolean {
    return this.terms.get(id)?.sessionId === sessionId
  }

  /** The learner typed or pasted into a terminal. */
  input(sessionId: string, id: string, data: string): void {
    if (this.owns(sessionId, id) && typeof data === 'string') this.terminals.write(id, data)
  }

  resize(sessionId: string, id: string, cols: number, rows: number): void {
    if (this.owns(sessionId, id)) this.terminals.resize(id, cols, rows)
  }

  /** Stop a run: its process and everything it started end. */
  stop(sessionId: string, id: string): void {
    const t = this.terms.get(id)
    if (!t || t.sessionId !== sessionId) return
    if (t.run && t.run.endedAt === null) t.run.stopped = true
    this.terminals.kill(id)
  }

  /** Close a tab: stop it if it still runs, and forget it. */
  close(sessionId: string, id: string): void {
    this.stop(sessionId, id)
    this.terms.delete(id)
    this.rawOutput.delete(id)
  }

  /** The session closed: end all its terminals. */
  closeSession(sessionId: string): void {
    for (const t of [...this.terms.values()]) if (t.sessionId === sessionId) this.close(sessionId, t.id)
    this.last.delete(sessionId)
  }

  /** The app is quitting: end everything. */
  closeAll(): void {
    for (const t of [...this.terms.values()]) this.close(t.sessionId, t.id)
  }

  /** This session's most recent finished run, or null. */
  lastRun(sessionId: string): RunSummary | null {
    return this.last.get(sessionId) ?? null
  }

  /** The terminals still open for a session (for a window that reloads). */
  openIds(sessionId: string): string[] {
    return [...this.terms.values()].filter((t) => t.sessionId === sessionId).map((t) => t.id)
  }

  private finishRun(t: Term, exitCode: number | null): void {
    const run = t.run!
    run.endedAt = this.now()
    run.exitCode = exitCode
    run.output = plainOutput(this.rawOutput.get(t.id) ?? '')
    let problems: { path: string; items: IdeDiagnostic[] } | null = null
    if (!run.stopped && exitCode !== 0) {
      const lang = languageOf(run.path)
      const err = lang ? parseRunError(lang, run.output, t.root, exitCode, run.path) : null
      if (err) {
        run.error = { type: err.type, message: err.message, path: err.at?.path ?? null, line: err.at?.line ?? null }
        run.words = runErrorInWords(err)
        if (err.at) {
          problems = {
            path: err.at.path,
            items: [{ line: err.at.line, col: 1, severity: 'error', code: err.type.split('.').at(-1)?.slice(0, 40), message: (err.type === 'error' ? err.message : `${err.type}: ${err.message}`).slice(0, 400) }]
          }
        }
      }
    }
    this.last.set(t.sessionId, run)
    this.emit({ type: 'run', run })
    for (const l of this.runEndListeners) l(t.sessionId, run, problems)
  }

  private emit(e: TerminalEvent): void {
    for (const l of this.listeners) l(e)
  }
}
