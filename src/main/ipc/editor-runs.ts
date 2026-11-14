import { isAbsolute, join, relative, sep } from 'node:path'
import type { FileProblems, RunSummary, TerminalEvent } from '../../shared/code'
import type { IdeCommand, ToIde } from '../../shared/ide'

/** The part of the Code area that ▶ Run from the editor uses. */
export interface RunArea {
  run(path: string, cols: number, rows: number): Promise<RunSummary>
  input(id: string, data: string): void
  resize(id: string, cols: number, rows: number): void
  stop(id: string): void
}

/**
 * ▶ Run pressed in VS Code: the app runs the file in its own terminal (the same run as the Code tab's, so the coach
 * sees the last run and errors get their plain-words line), and streams it back to the editor's "▶ Run" terminal.
 * Only runs the editor started are streamed back, and only their terminals take its keystrokes. Without Electron.
 */
export class EditorRuns {
  private ids = new Set<string>()

  constructor(
    private readonly area: RunArea,
    private readonly root: () => string,
    private readonly send: (m: ToIde) => void
  ) {}

  async command(m: IdeCommand): Promise<void> {
    switch (m.type) {
      case 'run': {
        const rel = this.inside(m.file)
        if (!rel) return this.send({ type: 'run_error', file: m.file, message: 'That file is not in this project.' })
        try {
          const run = await this.area.run(rel, m.cols, m.rows)
          this.ids.add(run.id)
          this.send({ type: 'term', event: { type: 'run', run } })
        } catch (err) {
          const message = err instanceof Error ? err.message.replace(/^\w*Error: /, '') : String(err)
          const install = err instanceof Error && 'install' in err ? (err as { install: { name: string; url: string } }).install : undefined
          this.send({ type: 'run_error', file: m.file, message, ...(install ? { install } : {}) })
        }
        return
      }
      case 'term_input':
        if (this.ids.has(m.id)) this.area.input(m.id, m.data)
        return
      case 'term_resize':
        if (this.ids.has(m.id)) this.area.resize(m.id, m.cols, m.rows)
        return
      case 'term_stop':
        if (this.ids.has(m.id)) this.area.stop(m.id)
        return
    }
  }

  /** A step's Check started a run: the editor shows it in its "▶ Check" terminal, with its output. */
  followCheck(run: RunSummary, label: string): void {
    const root = this.root()
    if (!root) return
    this.ids.add(run.id)
    this.send({ type: 'check_run', file: join(root, run.path), runId: run.id, label })
  }

  /** A terminal event from the hub: passed on when it belongs to a run the editor started. */
  event(e: TerminalEvent): void {
    const id = e.type === 'run' ? e.run.id : e.id
    if (this.ids.has(id)) this.send({ type: 'term', event: e })
  }

  /** Problems for a file: the run's (not the old editor's syntax checks) go to the editor as underlines. */
  problems(p: FileProblems): void {
    const root = this.root()
    if (!root) return
    const items = p.items.filter((i) => i.source === 'run').map(({ source: _source, ...d }) => d)
    this.send({ type: 'problems', file: join(root, p.path), items })
  }

  /** The session changed: earlier runs are no longer the editor's to follow. */
  reset(): void {
    this.ids.clear()
  }

  private inside(file: string): string | null {
    const root = this.root()
    if (!root || !isAbsolute(file)) return null
    const rel = relative(root, file)
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null
    return rel.split(sep).join('/')
  }
}
