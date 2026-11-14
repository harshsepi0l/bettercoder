import { dialog, ipcMain } from 'electron'
import { WORKSPACE_IPC } from '../../shared/workspace'
import { asString, type IpcContext } from './context'

/** Projects and sessions: open (folder, files or an idea), link a folder, new/open/rename/delete. */
export function registerWorkspaceIpc({ getWindow, ready, workspace }: IpcContext): void {
  ipcMain.handle(WORKSPACE_IPC.list, () => workspace.list())

  ipcMain.handle(WORKSPACE_IPC.open, async (_e, mode: unknown) => {
    await ready
    const win = getWindow()
    if (!win) return null
    // macOS can pick folders and files in one dialog; elsewhere a mode picks one or the other.
    const properties: Electron.OpenDialogOptions['properties'] =
      mode === 'folder'
        ? ['openDirectory']
        : mode === 'files'
          ? ['openFile', 'multiSelections']
          : process.platform === 'darwin'
            ? ['openDirectory', 'openFile', 'multiSelections']
            : ['openFile', 'multiSelections']
    const result = await dialog.showOpenDialog(win, {
      title: mode === 'folder' ? 'Open a folder (read-only)' : mode === 'files' ? 'Open files (read-only)' : 'Open a folder or files (read-only)',
      buttonLabel: 'Open',
      properties
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return workspace.openPaths(result.filePaths)
  })

  ipcMain.handle(WORKSPACE_IPC.startIdea, async (_e, idea: unknown) => {
    await ready
    const open = await workspace.startIdea(asString(idea, 'Idea'))
    // The idea is the first message; the reply streams in as usual.
    void workspace.send(open.project.idea ?? asString(idea, 'Idea'))
    return open
  })

  ipcMain.handle(WORKSPACE_IPC.linkFolder, async (_e, projectId: unknown) => {
    await ready
    const win = getWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: 'Link your project folder (read-only)',
      buttonLabel: 'Link folder',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return workspace.linkFolder(asString(projectId, 'Project'), result.filePaths[0])
  })

  ipcMain.handle(WORKSPACE_IPC.newSession, async (_e, projectId: unknown) => {
    await ready
    return workspace.newSession(asString(projectId, 'Project'))
  })

  ipcMain.handle(WORKSPACE_IPC.openSession, async (_e, sessionId: unknown) => {
    await ready
    return workspace.openSession(asString(sessionId, 'Session'))
  })

  ipcMain.handle(WORKSPACE_IPC.clearChat, (_e, sessionId: unknown) => workspace.clearChat(asString(sessionId, 'Session')))
  ipcMain.handle(WORKSPACE_IPC.renameSession, (_e, sessionId: unknown, title: unknown) =>
    workspace.renameSession(asString(sessionId, 'Session'), asString(title, 'Title'))
  )

  ipcMain.handle(WORKSPACE_IPC.deleteSession, (_e, sessionId: unknown) => workspace.deleteSession(asString(sessionId, 'Session')))

  ipcMain.handle(WORKSPACE_IPC.deleteProject, (_e, projectId: unknown) => workspace.deleteProject(asString(projectId, 'Project')))
}
