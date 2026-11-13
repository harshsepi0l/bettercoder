import { ipcMain } from 'electron'
import { TASKS_IPC, type SendTarget } from '../../shared/tasks'
import { asString, type IpcContext } from './context'

/** Tasks: list, add (the coach then writes the check), remove, Check my answer (their last ▶ Run), send. */
export function registerTasksIpc({ ready, workspace, ide }: IpcContext): void {
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
