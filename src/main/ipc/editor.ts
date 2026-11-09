import { ipcMain } from 'electron'
import { IDE_IPC } from '../../shared/ide'
import { resolveInside } from '../adapters/fs-readonly'
import type { IpcContext } from './context'

/** The editor link: its state for the panel, opening the editor's folder, and "Open in editor" (the Code tab's VS Code). */
export function registerEditorIpc({ ready, workspace, ide, getWindow }: IpcContext): void {
  ipcMain.handle(IDE_IPC.getState, () => ide.view())

  ipcMain.handle(IDE_IPC.openFolder, async () => {
    await ready
    const folder = ide.otherFolder()
    if (folder) await workspace.openFolder(folder)
  })

  ipcMain.handle(IDE_IPC.openInEditor, async (_e, path: unknown, line: unknown) => {
    await ready
    const p = workspace.activeProject()
    if (!p?.root) throw new Error('Link a folder first.')
    // Same sandbox as the coach's tools: inside the project, no secret files, only the files they opened.
    if (typeof path !== 'string' || path === '') throw new Error('Which file?')
    const { abs } = await resolveInside(p.root, path, p.files ? new Set(p.files) : undefined)
    // The extension opens it (a notebook's line is in the coach's view: it finds the cell), and the Code tab shows.
    ide.open(abs, typeof line === 'number' && line > 0 ? Math.floor(line) : null)
    getWindow()?.webContents.send(IDE_IPC.showCode)
  })
}
