import { app, ipcMain, session } from 'electron'
import { join } from 'node:path'
import { CODE_IPC, type VscodeFrame } from '../../shared/code'
import { IPC } from '../../shared/ipc'
import { CodeServer, withCookie } from '../adapters/code-server'
import { EditorImporter } from '../adapters/editor-import'
import { EDITOR_IMPORT_IPC, type EditorSourceId } from '../../shared/editor-import'
import type { IpcContext } from './context'

/**
 * The built-in VS Code in the Code tab. It opens the open session's project folder; projects without one (ideas) get
 * "Pick a folder". It is downloaded with `npm run vscode:fetch` (vendor/code-server).
 */
export function registerVscodeIpc({ workspace, getWindow }: IpcContext): { shutdown(): void } {
  const root = app.getAppPath()
  const server = new CodeServer({
    bin: join(root, 'vendor', 'code-server', 'bin', 'code-server'),
    dataDir: join(app.getPath('userData'), 'vscode'),
    extension: join(root, 'ide', 'vscode'),
    log: (line) => console.log('[vscode]', line)
  })

  // The app's own requests to VS Code carry its session cookie (the secret of this start). Only requests to that
  // one port get it; nothing else in the app sees the secret.
  let sentTo = ''
  const sendCookie = (url: string) => {
    const base = new URL(url).origin
    if (base === sentTo) return
    sentTo = base
    const { host } = new URL(base)
    session.defaultSession.webRequest.onBeforeSendHeaders(
      { urls: [`http://${host}/*`, `ws://${host}/*`] },
      (details, callback) => {
        const { name, value } = server.cookie
        callback({ requestHeaders: { ...details.requestHeaders, Cookie: withCookie(details.requestHeaders.Cookie, name, value) } })
      }
    )
  }

  // The app's theme changed (or was just worked out at launch): the window's own colours and the editor's theme.
  ipcMain.handle(IPC.setTheme, async (_e, theme: unknown) => {
    const shown = theme === 'light' ? 'light' : 'dark'
    const win = getWindow()
    const bg = shown === 'light' ? '#fbfbfa' : '#0f0f10'
    win?.setBackgroundColor(bg)
    if (process.platform !== 'darwin') win?.setTitleBarOverlay?.({ color: bg, symbolColor: shown === 'light' ? '#2a2a2d' : '#d6d4cf' })
    await server.setTheme(shown).catch((e) => console.log('[vscode] theme:', e))
  })

  ipcMain.handle(CODE_IPC.vscodeUrl, async (): Promise<VscodeFrame> => {
    if (!server.available()) return { kind: 'problem', message: 'VS Code is not downloaded yet. Run: npm run vscode:fetch' }
    const folder = workspace.activeProject()?.root
    if (!folder) return { kind: 'no-folder' }
    try {
      const url = await server.urlFor(folder)
      sendCookie(url)
      return { kind: 'ready', url }
    } catch (err) {
      return { kind: 'problem', message: err instanceof Error ? err.message : String(err) }
    }
  })

  // ── Bring your VS Code ──
  const importer = new EditorImporter(server)
  const sourceId = (v: unknown): EditorSourceId => {
    if (v === 'vscode' || v === 'insiders' || v === 'cursor' || v === 'windsurf' || v === 'vscodium') return v
    throw new Error('Unknown editor')
  }
  ipcMain.handle(EDITOR_IMPORT_IPC.sources, async () => ({ enabled: server.available(), sources: server.available() ? await importer.sources() : [] }))
  ipcMain.handle(EDITOR_IMPORT_IPC.plan, (_e, id: unknown) => importer.plan(sourceId(id)))
  let importing: Promise<unknown> | null = null
  ipcMain.handle(EDITOR_IMPORT_IPC.run, async (_e, id: unknown) => {
    if (!server.available()) throw new Error('VS Code is not downloaded yet. Run: npm run vscode:fetch')
    if (importing) throw new Error('Already bringing it over.')
    const job = importer.run(sourceId(id))
    importing = job
    try {
      return await job
    } finally {
      importing = null
      // It was stopped to install: the Code tab opens it again.
      sentTo = ''
      getWindow()?.webContents.send(EDITOR_IMPORT_IPC.restarted)
    }
  })

  return { shutdown: () => server.stop() }
}
