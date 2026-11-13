import { app, BrowserWindow, globalShortcut, ipcMain, shell } from 'electron'
import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { IPC } from '../shared/ipc'
import { registerHarness } from './ipc'

app.setName('BetterCoder')
// The app used to be called Waypoint: carry its sessions and settings over once.
// (Electron creates the new data folder itself at startup, so move the saved items, not the folder.)
{
  const legacy = join(app.getPath('appData'), 'waypoint')
  const current = app.getPath('userData')
  for (const item of ['projects', 'settings.json', 'credentials.bin']) {
    const from = join(legacy, item)
    const to = join(current, item)
    if (!existsSync(from) || existsSync(to)) continue
    try {
      mkdirSync(current, { recursive: true })
      renameSync(from, to)
    } catch {
      // Not fatal: the app simply starts without that item.
    }
  }
}

const TOGGLE_SHORTCUT = 'Alt+Space'
/** The whole window (VS Code's frame too) a little smaller than 100%, for more room. ⌘+ / ⌘− still change it. */
const ZOOM = 0.9
let win: BrowserWindow | null = null
function createWindow(): void {
  const isMac = process.platform === 'darwin'
  win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 360,
    minHeight: 480,
    show: false,
    title: 'BetterCoder',
    backgroundColor: '#1f1f1f',
    titleBarStyle: 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 12, y: 14 } }
      : { titleBarOverlay: { color: '#1f1f1f', symbolColor: '#c9c9c9', height: 40 } }),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      zoomFactor: ZOOM
    }
  })

  win.center()
  win.once('ready-to-show', () => win?.show())

  // Links open in the user's browser; the panel itself never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event) => event.preventDefault())

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }

  win.on('closed', () => {
    win = null
  })
}

function registerIpc(): void {
  const harness = registerHarness(() => win)
  // Save the open session before quitting.
  // Close the open session cleanly before quitting (pi-durable resumes anything unfinished next time).
  let closing = false
  app.on('before-quit', (event) => {
    if (closing) return
    closing = true
    event.preventDefault()
    void harness.flush().finally(() => app.quit())
  })

  ipcMain.handle(IPC.setPinned, (_event, pinned: unknown) => {
    const value = pinned === true
    win?.setAlwaysOnTop(value, 'floating')
    return value
  })

}

app.whenReady().then(() => {
  registerIpc()
  createWindow()

  globalShortcut.register(TOGGLE_SHORTCUT, () => {
    if (!win) return createWindow()
    if (win.isVisible() && win.isFocused()) win.hide()
    else {
      win.show()
      win.focus()
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => globalShortcut.unregisterAll())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
