import type { IdeCommand, ToIde } from '../../shared/ide'
import { resolveInside } from '../adapters/fs-readonly'
import { realTerminals, terminalEnv, terminalProblem } from '../adapters/pty'
import { planForFile } from '../adapters/toolchain'
import { findPython, projectPython } from '../engines/visualize/runner'
import { TerminalHub } from '../services/terminals'
import { CodeArea } from './code-area'
import type { IpcContext } from './context'
import { EditorRuns } from './editor-runs'

/**
 * ▶ Run, wired up: pressed in the built-in VS Code, it comes in over the editor link, runs in the app's own terminal
 * (the coach sees the last run, errors get their plain-words line) and streams back with its problems. Editing and
 * saving are VS Code's: nothing here writes into the project.
 */
export function registerRuns(
  { workspace, ide }: IpcContext,
  /** The editor link: ▶ Run pressed there comes in here, and its terminal and problems go back. */
  link: { send(m: ToIde): void; onCommand(handler: (m: IdeCommand) => void): void }
): { sessionClosed(sessionId: string): void; shutdown(): void } {
  const project = () => {
    const p = workspace.activeProject()
    const sessionId = workspace.activeSessionId()
    return p && sessionId ? { sessionId, root: p.root, files: p.files } : null
  }
  const root = () => project()?.root || ''

  let terminals: { hub: TerminalHub } | { problem: string } = { problem: 'The terminal is still starting.' }
  const area = new CodeArea({
    project,
    // Same gate as the coach's tools use for paths: inside the project, only the files they opened, no secret files.
    ensureTheirs: async (r, rel, allowed) => void (await resolveInside(r, rel, allowed)),
    terminals: () => terminals,
    plan: (r, rel, env) => planForFile(r, rel, env, async () => (await projectPython(r, rel)) ?? (await findPython())),
    env: terminalEnv,
    problems: (p) => editorRuns.problems(p),
    lastRun: (run) => ide.setLastRun(run)
  })
  const editorRuns = new EditorRuns(area, root, (m) => link.send(m))
  link.onCommand((m) => void editorRuns.command(m))
  void realTerminals().then(async (t) => {
    if (!t) {
      terminals = { problem: (await terminalProblem()) ?? 'node-pty could not start.' }
      return
    }
    const hub = new TerminalHub(t)
    hub.onEvent((e) => editorRuns.event(e))
    area.watchRuns(hub)
    terminals = { hub }
  })

  return {
    sessionClosed(sessionId: string) {
      if ('hub' in terminals) terminals.hub.closeSession(sessionId)
      area.sessionChanged(null)
      editorRuns.reset()
    },
    shutdown() {
      if ('hub' in terminals) terminals.hub.closeAll()
    }
  }
}
