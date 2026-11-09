import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import type { Terminals, TerminalSpawn } from '../ports'

/**
 * The learner's terminals: node-pty (MIT, N-API, so the same binary loads in Node and Electron). Each terminal is a
 * real pseudo-terminal. The process group is killed on close, so nothing they started keeps running unseen.
 */

type PtyModule = typeof import('node-pty')
type Pty = import('node-pty').IPty

let ptyModule: Promise<PtyModule> | null = null
/** node-pty is loaded on first use, so a broken native module only disables terminals, never the window. */
function loadPty(): Promise<PtyModule> {
  ptyModule ??= import('node-pty')
  return ptyModule
}

/** Is the terminal available here? Resolves to the reason when it isn't. */
export async function terminalProblem(): Promise<string | null> {
  try {
    await loadPty()
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

export function createTerminals(pty: PtyModule): Terminals {
  const live = new Map<string, Pty>()
  const dataListeners = new Set<(id: string, data: string) => void>()
  const exitListeners = new Set<(id: string, code: number | null, signal: number | null) => void>()
  let next = 0

  function killGroup(p: Pty): void {
    // The pty's process leads its own session: signal the whole group, then make sure.
    try {
      process.kill(-p.pid, 'SIGHUP')
    } catch {
      // already gone
    }
    try {
      p.kill()
    } catch {
      // already gone
    }
    setTimeout(() => {
      try {
        process.kill(-p.pid, 'SIGKILL')
      } catch {
        // already gone
      }
    }, 1500).unref?.()
  }

  return {
    spawn(opts: TerminalSpawn): string {
      const id = `t${++next}`
      const p = pty.spawn(opts.command, opts.args, {
        name: 'xterm-256color',
        cols: Math.max(2, Math.floor(opts.cols)),
        rows: Math.max(1, Math.floor(opts.rows)),
        cwd: opts.cwd,
        env: opts.env
      })
      live.set(id, p)
      p.onData((data) => {
        for (const l of dataListeners) l(id, data)
      })
      p.onExit(({ exitCode, signal }) => {
        live.delete(id)
        for (const l of exitListeners) l(id, exitCode ?? null, signal ?? null)
      })
      return id
    },
    write(id, data) {
      live.get(id)?.write(data)
    },
    resize(id, cols, rows) {
      const p = live.get(id)
      if (p) p.resize(Math.max(2, Math.floor(cols)), Math.max(1, Math.floor(rows)))
    },
    kill(id) {
      const p = live.get(id)
      if (p) killGroup(p)
    },
    onData(listener) {
      dataListeners.add(listener)
      return () => dataListeners.delete(listener)
    },
    onExit(listener) {
      exitListeners.add(listener)
      return () => exitListeners.delete(listener)
    }
  }
}

/** The real terminals, or null (with the reason logged) when node-pty can't load on this machine. */
export async function realTerminals(): Promise<Terminals | null> {
  try {
    return createTerminals(await loadPty())
  } catch (err) {
    console.warn('[bettercoder] terminal unavailable:', err instanceof Error ? err.message : err)
    return null
  }
}

/** The learner's login shell. */
export function userShell(): string {
  return process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : '/bin/zsh')
}

let loginEnv: Promise<Record<string, string>> | null = null

/**
 * The environment their own terminal app would have. An app opened from the Dock gets only launchd's short PATH, so
 * ask their login shell once (as editors do) and start terminals from that.
 */
export function shellEnvironment(): Promise<Record<string, string>> {
  loginEnv ??= new Promise((done) => {
    const base = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string'))
    if (process.platform === 'win32') return done(base)
    execFile(userShell(), ['-l', '-i', '-c', 'env -0'], { timeout: 5000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' }, (err, out) => {
      if (err || !out) return done(base)
      const env: Record<string, string> = {}
      for (const pair of out.split('\0')) {
        const eq = pair.indexOf('=')
        if (eq > 0) env[pair.slice(0, eq)] = pair.slice(eq + 1)
      }
      done(env.PATH ? env : base)
    })
  })
  return loginEnv
}

/** The project's virtual environment folder (the nearest .venv, venv or env at the project root), or null. */
export function projectVenv(root: string): string | null {
  if (!root) return null
  for (const dir of ['.venv', 'venv', 'env']) {
    const bin = join(root, dir, process.platform === 'win32' ? 'Scripts' : 'bin')
    if (existsSync(join(bin, process.platform === 'win32' ? 'python.exe' : 'python'))) return join(root, dir)
  }
  return null
}

/**
 * The environment for a terminal in this project: their login environment, with the project's venv "activated" (its
 * bin first on PATH and VIRTUAL_ENV set, which works in any shell without sourcing a script).
 */
export async function terminalEnv(root: string): Promise<Record<string, string>> {
  const env = { ...(await shellEnvironment()) }
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.TERM_PROGRAM = 'BetterCoder'
  delete env.ELECTRON_RUN_AS_NODE
  const venv = projectVenv(root)
  if (venv) {
    env.VIRTUAL_ENV = venv
    env.PATH = [join(venv, process.platform === 'win32' ? 'Scripts' : 'bin'), env.PATH ?? ''].filter(Boolean).join(delimiter)
    delete env.PYTHONHOME
  }
  return env
}
