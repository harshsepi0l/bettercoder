import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { lstat, mkdir, readFile, readdir, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { isAiExtension } from '../core/ai-extensions'
import { FORCED_SETTINGS } from '../core/editor-import'
import { parseJsonc } from '../core/jsonc'

/**
 * The open-source VS Code (code-server, MIT) that runs in the Code tab. One server for the app, on a free port on
 * 127.0.0.1; each session opens its project folder in it. Its own settings and extensions live in the app's data
 * folder, never in the learner's own VS Code. Extensions come from Open VSX (code-server's default gallery). The
 * BetterCoder extension is registered in, so the coach follows this editor over the same socket as before.
 * Pure Node (no Electron).
 *
 * Locked: every start makes a new random secret and gives it to code-server as its "hashed password". code-server
 * then accepts only a session cookie equal to that secret, which only the app sends (ipc/vscode.ts adds it to the
 * app's own requests). A web page or another program that reaches the port gets the login page, and no typed
 * password can match a random secret.
 */

/** code-server's own config file. The flags BetterCoder passes say the same and win; this only has to be valid. */
export const CONFIG_YAML = '# BetterCoder starts code-server with its own flags and a new secret each time.\nauth: password\ncert: false\n'

/** code-server's session cookie (no suffix). */
export const SESSION_COOKIE = 'code-server-session'

/**
 * Settings it starts with, only while the learner's settings don't have them (their own choices and imported VS Code
 * settings win): our theme and a quiet start. The rules that always win (no AI, nothing typed in for them, the app's
 * own layout) are FORCED_SETTINGS, put back on every start.
 */
/** The app's own editor themes (ide/vscode/themes), one per app theme. */
export const EDITOR_THEMES = { dark: 'BetterCoder Dark', light: 'BetterCoder Light' } as const

/**
 * The learner's settings with the editor theme matching the app's, or null when nothing changes. Only while they are
 * on one of our two themes (or none): a theme they picked or brought from their own VS Code is theirs to keep.
 */
export function withEditorTheme(text: string | null, theme: 'dark' | 'light'): string | null {
  const parsed = text === null ? null : parseJsonc(text)
  const current = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  const now = current['workbench.colorTheme']
  const ours = now === undefined || now === EDITOR_THEMES.dark || now === EDITOR_THEMES.light
  if (!ours || now === EDITOR_THEMES[theme]) return null
  return JSON.stringify({ ...current, 'workbench.colorTheme': EDITOR_THEMES[theme] }, null, 2) + '\n'
}

export const STARTING_SETTINGS: Record<string, unknown> = {
  'workbench.colorTheme': 'BetterCoder Dark',
  'workbench.startupEditor': 'none'
}

/**
 * The learner's settings with any missing starting setting added and the forced ones put back. Null when nothing
 * changes. Their file may have comments (VS Code allows them): it is read as JSONC, and rewritten as plain JSON only
 * when something has to change. A file that can't be read at all is replaced, so the forced rules always hold.
 */
export function withStartingSettings(text: string | null): string | null {
  const parsed = text === null ? null : parseJsonc(text)
  const current = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  if (!current) return JSON.stringify({ ...STARTING_SETTINGS, ...FORCED_SETTINGS }, null, 2) + '\n'
  const missing = Object.entries(STARTING_SETTINGS).filter(([k]) => !(k in current))
  const wrong = Object.entries(FORCED_SETTINGS).filter(([k, v]) => JSON.stringify(current[k]) !== JSON.stringify(v))
  if (missing.length === 0 && wrong.length === 0) return null
  return JSON.stringify({ ...current, ...Object.fromEntries(missing), ...FORCED_SETTINGS }, null, 2) + '\n'
}

export interface CodeServerOptions {
  /** vendor/code-server/bin/code-server */
  bin: string
  /** Where its settings, state and extensions live (in the app's data folder). */
  dataDir: string
  /** The BetterCoder extension's folder (ide/vscode), linked into its extensions. */
  extension: string
  log?: (line: string) => void
}

export class CodeServer {
  /** The app's theme, for the editor's (set before or after it starts). */
  private theme: 'dark' | 'light' = 'dark'
  private child: ChildProcess | null = null
  private starting: Promise<string> | null = null
  /** The secret of the running server: the only session cookie it accepts. */
  private secret = ''

  constructor(private readonly opts: CodeServerOptions) {}

  available(): boolean {
    return existsSync(this.opts.bin)
  }

  /** The address that opens `folder` in it (starting the server the first time). */
  async urlFor(folder: string): Promise<string> {
    const base = await this.start()
    return `${base}/?folder=${encodeURIComponent(folder)}`
  }

  start(): Promise<string> {
    this.starting ??= this.boot().catch((err) => {
      this.starting = null
      throw err
    })
    return this.starting
  }

  /** The session cookie the app sends with its own requests (empty until it has started). */
  get cookie(): { name: string; value: string } {
    return { name: SESSION_COOKIE, value: this.secret }
  }

  stop(): void {
    this.child?.kill()
    this.child = null
    this.starting = null
  }

  get extensionsDir(): string {
    return join(this.opts.dataDir, 'extensions')
  }

  get userDataDir(): string {
    return join(this.opts.dataDir, 'user-data')
  }

  private async boot(): Promise<string> {
    if (!this.available()) throw new Error('VS Code is not installed yet. Run: npm run vscode:fetch')
    await this.prepare()
    const port = await this.port()
    const base = `http://127.0.0.1:${port}`
    const secret = randomBytes(32).toString('hex')
    const config = join(this.opts.dataDir, 'config.yaml')
    const args = [
      '--bind-addr', `127.0.0.1:${port}`,
      '--auth', 'password',
      '--config', config,
      '--user-data-dir', this.userDataDir,
      '--extensions-dir', this.extensionsDir,
      '--disable-telemetry',
      '--disable-update-check',
      '--disable-workspace-trust',
      '--disable-getting-started-override',
      '--ignore-last-opened'
    ]
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    delete env.NODE_OPTIONS
    delete env.PASSWORD
    // Tells the BetterCoder extension it runs inside BetterCoder (it then removes AI extensions and keeps the forced
    // settings); in the learner's own VS Code it only links.
    env.BETTERCODER_EMBEDDED = '1'
    // Not an argon2 or sha256 hash of anything: code-server compares the session cookie with it as it is.
    env.HASHED_PASSWORD = secret
    const child = spawn(this.opts.bin, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
    this.child = child
    const log = this.opts.log ?? (() => undefined)
    child.stdout?.on('data', (d: Buffer) => log(d.toString().trimEnd()))
    child.stderr?.on('data', (d: Buffer) => log(d.toString().trimEnd()))
    child.on('exit', (code) => {
      log(`code-server exited (${code})`)
      if (this.child === child) {
        this.child = null
        this.starting = null
      }
    })
    await waitForHealth(base, child)
    this.secret = secret
    return base
  }

  /** The app's theme changed: the editor follows (VS Code picks a changed settings file up by itself). */
  async setTheme(theme: 'dark' | 'light'): Promise<void> {
    this.theme = theme
    const settings = join(this.userDataDir, 'User', 'settings.json')
    const next = withEditorTheme(await readFile(settings, 'utf8').catch(() => null), theme)
    if (next !== null) {
      await mkdir(join(this.userDataDir, 'User'), { recursive: true })
      await writeFile(settings, next)
    }
  }

  /** Its folders, the starting settings it is missing, and the BetterCoder extension registered in. */
  private async prepare(): Promise<void> {
    const userDir = join(this.userDataDir, 'User')
    await mkdir(userDir, { recursive: true })
    await mkdir(this.extensionsDir, { recursive: true })
    // Its own config, so code-server never writes one of its own (with a password) into ~/.config. It must hold at
    // least one setting: a file of only comments is "an empty document" and code-server refuses to start.
    await writeFile(join(this.opts.dataDir, 'config.yaml'), CONFIG_YAML)
    const settings = join(userDir, 'settings.json')
    const next = withStartingSettings(await readFile(settings, 'utf8').catch(() => null))
    if (next !== null) await writeFile(settings, next)
    const themed = withEditorTheme(await readFile(settings, 'utf8').catch(() => null), this.theme)
    if (themed !== null) await writeFile(settings, themed)
    await registerExtension(this.extensionsDir, this.opts.extension)
    const removed = await removeAiExtensions(this.extensionsDir)
    if (removed.length) this.opts.log?.(`removed AI extensions: ${removed.join(', ')}`)
    await hideOtherRunButtons(this.extensionsDir)
  }

  /**
   * The same port every start when it is free: VS Code keeps its window state (open tabs, layout, kernel picks) in
   * browser storage for its address, so a new port each time would start it from scratch.
   */
  private async port(): Promise<number> {
    const file = join(this.opts.dataDir, 'port.json')
    const saved = await readJson<{ port?: number }>(file, {})
    if (typeof saved.port === 'number') {
      // Just restarted: the old process may hold it for a moment longer.
      for (let i = 0; i < 12; i++) {
        if (await portFree(saved.port)) return saved.port
        await new Promise((r) => setTimeout(r, 150))
      }
    }
    const port = await freePort()
    await writeFile(file, JSON.stringify({ port }))
    return port
  }

  /**
   * Install extensions from Open VSX into its own folder (VS Code must be stopped; it starts again on the next
   * urlFor). Returns the ids that are installed afterwards.
   */
  async install(ids: readonly string[]): Promise<{ installed: string[]; failed: string[] }> {
    if (!this.available()) throw new Error('VS Code is not installed yet. Run: npm run vscode:fetch')
    this.stop()
    await this.prepare()
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    delete env.NODE_OPTIONS
    const installed: string[] = []
    const failed: string[] = []
    // A few at a time: one bad id fails only its own batch, and the CLI reports nothing per id we could trust.
    for (let i = 0; i < ids.length; i += 4) {
      const batch = ids.slice(i, i + 4)
      const args = ['--config', join(this.opts.dataDir, 'config.yaml'), '--user-data-dir', this.userDataDir, '--extensions-dir', this.extensionsDir]
      for (const id of batch) args.push('--install-extension', id)
      await new Promise<void>((resolve) => {
        const child = spawn(this.opts.bin, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
        child.stdout?.on('data', (d: Buffer) => this.opts.log?.(d.toString().trimEnd()))
        child.stderr?.on('data', (d: Buffer) => this.opts.log?.(d.toString().trimEnd()))
        child.on('exit', () => resolve())
        child.on('error', () => resolve())
      })
    }
    const have = new Set((await readJson<Array<{ identifier?: { id?: string } }>>(join(this.extensionsDir, 'extensions.json'), [])).map((e) => e.identifier?.id?.toLowerCase()))
    for (const id of ids) (have.has(id.toLowerCase()) ? installed : failed).push(id)
    // Anything AI that came along (a pack can pull one in) goes straight back out.
    await removeAiExtensions(this.extensionsDir)
    return { installed, failed }
  }
}

interface ListedExtension {
  identifier?: { id?: string }
  relativeLocation?: string
  location?: { path?: string }
}

/**
 * Takes every AI extension out of VS Code's list (and marks it removed), whatever put it there. Returns their ids.
 * Runs on every start, so one installed while the app was closed never loads.
 */
export async function removeAiExtensions(extensionsDir: string): Promise<string[]> {
  const listPath = join(extensionsDir, 'extensions.json')
  const list = await readJson<ListedExtension[]>(listPath, [])
  const removed: ListedExtension[] = []
  const kept: ListedExtension[] = []
  for (const e of list) {
    const id = e.identifier?.id ?? ''
    const folder = e.location?.path ?? (e.relativeLocation ? join(extensionsDir, e.relativeLocation) : null)
    const manifest = folder ? await readJson<Record<string, unknown> | null>(join(folder, 'package.json'), null) : null
    ;(isAiExtension(id, manifest) ? removed : kept).push(e)
  }
  if (removed.length === 0) return []
  await writeFile(listPath, JSON.stringify(kept))
  const obsoletePath = join(extensionsDir, '.obsolete')
  const obsolete = await readJson<Record<string, boolean>>(obsoletePath, {})
  for (const e of removed) if (e.relativeLocation) obsolete[e.relativeLocation] = true
  await writeFile(obsoletePath, JSON.stringify(obsolete))
  return removed.map((e) => e.identifier?.id ?? '')
}

/**
 * Other extensions' own Run buttons in the editor's title bar, for files ▶ Run covers: they run outside BetterCoder, so
 * the coach never sees the run and errors get no plain-words line. Debug buttons stay (stepping through is theirs).
 */
export const HIDDEN_RUN_BUTTONS: Record<string, string[]> = {
  'ms-python.python': ['python.execInTerminal-icon', 'python.execInDedicatedTerminal'],
  'ms-python.vscode-python-envs': ['python-envs.runAsTask'],
  'ms-toolsai.jupyter': ['jupyter.runFileInteractive'],
  'vscjava.vscode-java-debug': ['java.debug.runJavaFile'],
  'formulahendry.code-runner': ['code-runner.run']
}

/**
 * Removes those Run buttons from BetterCoder's own copy of the extension (its manifest's title-bar menu), so ▶ Run is
 * the one Run there. The commands themselves stay. Runs on every start, so an updated extension is fixed again.
 */
export async function hideOtherRunButtons(extensionsDir: string): Promise<number> {
  let changed = 0
  const folders = await readdir(extensionsDir).catch(() => [] as string[])
  for (const [id, commands] of Object.entries(HIDDEN_RUN_BUTTONS)) {
    for (const folder of folders.filter((f) => f.toLowerCase().startsWith(`${id}-`) && /^\d/.test(f.slice(id.length + 1)))) {
      const path = join(extensionsDir, folder, 'package.json')
      const manifest = await readJson<{ contributes?: { menus?: Record<string, Array<{ command?: string }>> } } | null>(path, null)
      const menus = manifest?.contributes?.menus
      if (!manifest || !menus) continue
      let touched = false
      for (const where of ['editor/title/run', 'editor/title']) {
        const items = menus[where]
        if (!Array.isArray(items)) continue
        const left = items.filter((m) => !commands.includes(m.command ?? ''))
        if (left.length !== items.length) {
          menus[where] = left
          touched = true
        }
      }
      if (touched) {
        await writeFile(path, JSON.stringify(manifest, null, 2))
        changed++
      }
    }
  }
  return changed
}

/**
 * Links an unpacked extension folder into the extensions folder and lists it in `extensions.json`, which is what
 * VS Code reads (a folder that is only linked in gets marked as removed in `.obsolete`).
 */
export async function registerExtension(extensionsDir: string, folder: string): Promise<string> {
  const manifest = JSON.parse(await readFile(join(folder, 'package.json'), 'utf8')) as { publisher: string; name: string; version: string }
  const id = `${manifest.publisher}.${manifest.name}`.toLowerCase()
  const relativeLocation = `${id}-${manifest.version}`
  const link = join(extensionsDir, relativeLocation)
  const current = await lstat(link).then((st) => (st.isSymbolicLink() ? readlink(link) : 'not-a-link'), () => null)
  if (current !== folder) {
    await rm(link, { recursive: true, force: true })
    await symlink(folder, link, 'dir')
  }

  const listPath = join(extensionsDir, 'extensions.json')
  const list = await readJson<Array<{ identifier?: { id?: string } }>>(listPath, [])
  const others = list.filter((e) => e.identifier?.id?.toLowerCase() !== id)
  others.push({
    identifier: { id },
    version: manifest.version,
    location: { $mid: 1, path: link, scheme: 'file' },
    relativeLocation,
    metadata: { installedTimestamp: Date.now(), source: 'vsix', pinned: true }
  } as { identifier: { id: string } })
  await writeFile(listPath, JSON.stringify(others))

  const obsoletePath = join(extensionsDir, '.obsolete')
  const obsolete = await readJson<Record<string, boolean>>(obsoletePath, {})
  if (relativeLocation in obsolete) {
    delete obsolete[relativeLocation]
    await writeFile(obsoletePath, JSON.stringify(obsolete))
  }
  return id
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return fallback
  }
}

/** A Cookie header with `name=value` set (replacing any value the page had for it). */
export function withCookie(header: string | undefined, name: string, value: string): string {
  const others = (header ?? '')
    .split(';')
    .map((c) => c.trim())
    .filter((c) => c && !c.startsWith(`${name}=`))
  return [...others, `${name}=${value}`].join('; ')
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer()
    srv.once('error', () => resolve(false))
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)))
  })
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => (port ? resolve(port) : reject(new Error('No free port'))))
    })
  })
}

async function waitForHealth(base: string, child: ChildProcess, timeoutMs = 30_000): Promise<void> {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error(`VS Code stopped while starting (exit ${child.exitCode}).`)
    try {
      const res = await fetch(`${base}/healthz`)
      if (res.ok) return
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('VS Code did not start in 30 seconds.')
}
