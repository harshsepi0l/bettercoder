import { readFile } from 'node:fs/promises'
import { ipcMain } from 'electron'
import { VISUALIZE_IPC } from '../../shared/visualize'
import type { ScenarioCall } from '../../shared/trace'
import { resolveInside } from '../adapters/fs-readonly'
import { notebookToPython } from '../core/text-view'
import { pythonFiles, runTrace } from '../engines/visualize/runner'
import { pythonOutline } from '../engines/visualize/scenario'
import { asString, needProject, type IpcContext } from './context'

/** The Visualize tab: which files can run, a file's functions, and a run. */
export function registerVisualizeIpc({ workspace }: IpcContext): void {
  ipcMain.handle(VISUALIZE_IPC.files, async () => pythonFiles(needProject(workspace)))

  ipcMain.handle(VISUALIZE_IPC.outline, async (_e, file: unknown) => {
    const p = needProject(workspace)
    const name = asString(file, 'File')
    const { abs } = await resolveInside(p.root, name, p.files ? new Set(p.files) : undefined)
    const raw = await readFile(abs, 'utf8')
    return pythonOutline(name.toLowerCase().endsWith('.ipynb') ? (notebookToPython(raw)?.code ?? '') : raw)
  })

  ipcMain.handle(VISUALIZE_IPC.run, async (_e, file: unknown, scenario: unknown) => {
    const p = needProject(workspace)
    return runTrace({ root: p.root, files: p.files, file: asString(file, 'File'), scenario: scenario as ScenarioCall[] })
  })
}
