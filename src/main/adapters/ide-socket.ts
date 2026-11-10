import { chmod, mkdir, rm } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { FromIde, IdeCommand, ToIde } from '../../shared/ide'
import type { EditorFeed, EditorSnapshot } from '../ports'
import { MAX_LINE, applyFromIde, emptySnapshot, isIdeCommand, parseIdeMessage } from './editor-snapshot'

export { errorKey, parseIdeMessage } from './editor-snapshot'

/**
 * The local socket the editor extension connects to. One JSON message per line. The socket lives in a folder only
 * this user can open, so no other account on the machine can talk to it. Pure Node (no Electron), so it is tested.
 */

export const DEFAULT_SOCKET = join(homedir(), '.bettercoder', 'ide.sock')

interface Connection {
  socket: Socket
  snap: EditorSnapshot
  /** When this window last sent anything (ms). */
  lastAt: number
}

export class IdeBridge implements EditorFeed {
  private server: Server | null = null
  private connections = new Set<Connection>()
  /** The window the learner used last: the one BetterCoder follows. */
  private active: Connection | null = null
  /** Sent again to every editor that connects, so a restarted editor gets its marker back. */
  private lastAnchor: ToIde | null = null
  private lastStatus: ToIde | null = null
  /** "Open in editor" asked for before the editor connected (the Code tab was only now opening it). */
  private pendingOpen: { message: ToIde; at: number } | null = null
  /** Who handles ▶ Run and terminal keystrokes from the editor (the Code area), once it is ready. */
  private commands: ((m: IdeCommand) => void) | null = null

  constructor(
    private readonly onChange: () => void,
    private readonly now: () => number = Date.now
  ) {}

  async listen(path = DEFAULT_SOCKET): Promise<void> {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    await chmod(dirname(path), 0o700).catch(() => undefined)
    // A socket file left by a crash would block listen.
    await rm(path, { force: true })
    const server = createServer((socket) => this.accept(socket))
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(path, () => {
        server.off('error', reject)
        resolve()
      })
    })
    await chmod(path, 0o600).catch(() => undefined)
    this.server = server
  }

  async close(): Promise<void> {
    for (const c of this.connections) c.socket.destroy()
    this.connections.clear()
    this.active = null
    const server = this.server
    this.server = null
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  /** What the followed editor window reports, if one is connected. */
  snapshot(): EditorSnapshot | null {
    return this.active?.snap ?? null
  }

  /** When the learner last used the followed window, for choosing between it and the built-in editor. */
  lastActivityAt(): number | null {
    return this.active?.lastAt ?? null
  }

  /** ▶ Run and terminal keystrokes from the editor go to this handler. */
  onCommand(handler: (m: IdeCommand) => void): void {
    this.commands = handler
  }

  /** Send to every connected editor (each shows the marker only on its own copy of the file). */
  send(message: ToIde): void {
    if (message.type === 'anchor' || message.type === 'clear') this.lastAnchor = message
    if (message.type === 'status') this.lastStatus = message
    if (message.type === 'open' && this.connections.size === 0) {
      this.pendingOpen = { message, at: this.now() }
      return
    }
    const line = `${JSON.stringify(message)}\n`
    for (const c of this.connections) if (!c.socket.destroyed) c.socket.write(line)
  }

  private accept(socket: Socket): void {
    const conn: Connection = {
      socket,
      snap: emptySnapshot(),
      lastAt: this.now()
    }
    this.connections.add(conn)
    socket.setEncoding('utf8')
    let buffer = ''
    socket.on('data', (chunk: string) => {
      buffer += chunk
      if (buffer.length > MAX_LINE * 2 && !buffer.includes('\n')) {
        buffer = ''
        return
      }
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        const message = parseIdeMessage(line)
        if (message) this.apply(conn, message)
      }
    })
    const gone = () => {
      if (!this.connections.delete(conn)) return
      if (this.active === conn) this.active = [...this.connections].at(-1) ?? null
      this.onChange()
    }
    socket.on('close', gone)
    socket.on('error', gone)
    for (const m of [this.lastAnchor, this.lastStatus]) if (m) socket.write(`${JSON.stringify(m)}\n`)
    if (this.pendingOpen && this.now() - this.pendingOpen.at < 60_000) socket.write(`${JSON.stringify(this.pendingOpen.message)}\n`)
    this.pendingOpen = null
  }

  private apply(conn: Connection, m: FromIde): void {
    if (isIdeCommand(m)) {
      conn.lastAt = this.now()
      this.commands?.(m)
      return
    }
    // A window says hello, or reports its editor when it gains focus: that window is the one to follow.
    if (m.type === 'editor' || (m.type === 'hello' && !this.active)) this.active = conn
    if (!applyFromIde(conn.snap, m, this.now())) return
    conn.lastAt = this.now()
    this.onChange()
  }
}
