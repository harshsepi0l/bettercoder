import { ipcMain, shell } from 'electron'
import { IDE_IPC } from '../../shared/ide'
import { resolveInside } from '../adapters/fs-readonly'
import { editorUrl } from '../core/editor-url'
import type { IpcContext } from './context'

/** The editor link: its state for the panel, opening the editor's folder, and "Open in editor". */
export function registerEditorIpc({ ready, workspace, ide }: IpcContext): void {
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
    const abs =
      typeof path === 'string' && path !== ''
        ? (await resolveInside(p.root, path, p.files ? new Set(p.files) : undefined)).abs
        : p.root
    // A notebook's line numbers are BetterCoder's cell view, not the editor's: open it at the top.
    const at = typeof line === 'number' && !abs.toLowerCase().endsWith('.ipynb') ? line : undefined
    await shell.openExternal(editorUrl(ide.ideName(), abs, at))
  })
}
