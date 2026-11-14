import { ipcMain } from 'electron'
import { TASKS_IPC, type SendTarget } from '../../shared/tasks'
import type { RunSummary } from '../../shared/code'
import type { StepOfTask } from '../../shared/step-checks'
import { asString, type IpcContext } from './context'

/** Tasks: list, add (the coach then writes the check), remove, Check my answer (their last ▶ Run), send. */
export function registerTasksIpc(
  { ready, workspace, ide }: IpcContext,
  /** ▶ Run's machinery for a step's Check (null until it is set up). */
  runs: () => { runCheck(path: string, inputs: readonly string[], label: string): Promise<{ run: RunSummary; timedOut: boolean }> } | null
): void {
  // Check a step card: the file the step is in, else the one open in the editor, else the last run's.
  ipcMain.handle(TASKS_IPC.checkStep, async (_e, title: unknown, checks: unknown, path: unknown, of: unknown) => {
    const r = runs()
    if (!r) throw new Error('▶ Run is still starting.')
    const file = (typeof path === 'string' && path) || ide.editorFile() || ide.lastRunNow()?.path
    if (!file) throw new Error('Open the file this step is in, then press Check.')
    const o = of as Partial<StepOfTask> | null
    const step = o && typeof o.taskId === 'string' && Number.isInteger(o.step) ? { taskId: o.taskId, step: o.step as number } : null
    return workspace.checkStep(asString(title, 'Step'), checks as never, file, step, (p, inputs, label) => r.runCheck(p, inputs, label))
  })
  ipcMain.handle(TASKS_IPC.list, () => workspace.tasks())
  ipcMain.handle(TASKS_IPC.add, (_e, title: unknown) => workspace.addTask(asString(title, 'Task')))
  ipcMain.handle(TASKS_IPC.remove, (_e, id: unknown) => workspace.removeTask(asString(id, 'Task')))
  ipcMain.handle(TASKS_IPC.check, (_e, id: unknown) => void workspace.checkTask(asString(id, 'Task'), ide.lastRunNow()))
  ipcMain.handle(TASKS_IPC.send, async (_e, ids: unknown, target: unknown) => {
    await ready
    const list = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []
    const t = target as Partial<SendTarget> | null
    const to: SendTarget = t?.kind === 'session' ? { kind: 'session', sessionId: asString((t as { sessionId?: unknown }).sessionId, 'Session') } : { kind: 'new' }
    await workspace.sendTasks(list, to)
  })
}
