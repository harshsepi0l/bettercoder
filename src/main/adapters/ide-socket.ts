import { chmod, mkdir, rm } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { FromIde, IdeDiagnostic, ToIde } from '../../shared/ide'
import type { EditorFeed, EditorSnapshot } from '../ports'

/**
 * The local socket the editor extension connects to. One JSON message per line. The socket lives in a folder only
 * this user can open, so no other account on the machine can talk to it. Pure Node (no Electron), so it is tested.
 */

export const DEFAULT_SOCKET = join(homedir(), '.bettercoder', 'ide.sock')
/** A longer line is dropped: no editor message needs more (doc text is capped by the extension too). */
const MAX_LINE = 600_000
const MAX_TEXT = 400_000
const MAX_DIAGNOSTICS = 20


/** Parse one line from the editor. Anything malformed is ignored, never thrown. */
export function parseIdeMessage(line: string): FromIde | null {
  if (line.length > MAX_LINE) return null
  let m: unknown
  try {
    m = JSON.parse(line)
  } catch {
    return null
  }
  if (!m || typeof m !== 'object') return null
  const o = m as Record<string, unknown>
  const str = (v: unknown, max = 4096) => (typeof v === 'string' && v.length <= max ? v : null)
  const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 10_000_000 ? v : null)
  switch (o.type) {
    case 'hello': {
      const ide = str(o.ide, 40)
      const folders = Array.isArray(o.folders) ? o.folders.map((f) => str(f)).filter((f): f is string => !!f).slice(0, 20) : []
      return ide ? { type: 'hello', ide, folders } : null
    }
    case 'editor': {
      const line = int(o.line)
      const col = int(o.col)
      const file = o.file === null ? null : str(o.file)
      if (line === null || col === null || file === undefined) return null
      if (o.file !== null && file === null) return null
      return { type: 'editor', file, line, col }
    }
    case 'doc': {
      const file = str(o.file)
      const text = str(o.text, MAX_TEXT)
      return file && text !== null ? { type: 'doc', file, text } : null
    }
    case 'diagnostics': {
      const file = str(o.file)
      if (!file || !Array.isArray(o.items)) return null
      const items: IdeDiagnostic[] = []
      for (const d of o.items.slice(0, MAX_DIAGNOSTICS)) {
        if (!d || typeof d !== 'object') continue
        const x = d as Record<string, unknown>
        const line = int(x.line)
        const col = int(x.col)
        const message = str(x.message, 400)
        if (line === null || col === null || !message) continue
        const code = str(x.code, 40)
        items.push({ line, col, severity: x.severity === 'error' ? 'error' : 'warning', ...(code ? { code } : {}), message })
      }
      return { type: 'diagnostics', file, items }
    }
    case 'step_done': {
      const stepId = str(o.stepId, 200)
      return stepId ? { type: 'step_done', stepId } : null
    }
    default:
      return null
  }
}

/** The same errors (by code and message, not line: lines move as they type) count as one unchanged problem. */
export function errorKey(items: readonly IdeDiagnostic[]): string {
  return items
    .filter((d) => d.severity === 'error')
    .map((d) => `${d.code ?? ''}:${d.message}`)
    .sort()
    .join('\n')
}

interface Connection {
  socket: Socket
  snap: EditorSnapshot
}

export class IdeBridge implements EditorFeed {
  private server: Server | null = null
  private connections = new Set<Connection>()
  /** The window the learner used last: the one BetterCoder follows. */
  private active: Connection | null = null
  /** Sent again to every editor that connects, so a restarted editor gets its marker back. */
  private lastAnchor: ToIde | null = null
  private lastStatus: ToIde | null = null

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

  /** Send to every connected editor (each shows the marker only on its own copy of the file). */
  send(message: ToIde): void {
    if (message.type === 'anchor' || message.type === 'clear') this.lastAnchor = message
    if (message.type === 'status') this.lastStatus = message
    const line = `${JSON.stringify(message)}\n`
    for (const c of this.connections) if (!c.socket.destroyed) c.socket.write(line)
  }

  private accept(socket: Socket): void {
    const conn: Connection = {
      socket,
      snap: { ide: 'Editor', folders: [], file: null, line: 0, col: 0, text: null, diagnostics: [], lastEditAt: null, errors: null, stepsDone: new Set() }
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
  }

  private apply(conn: Connection, m: FromIde): void {
    const s = conn.snap
    const now = this.now()
    switch (m.type) {
      case 'hello':
        s.ide = m.ide
        s.folders = m.folders
        if (!this.active) this.active = conn
        break
      case 'editor':
        // A window reports its editor when it gains focus: that window is the one to follow.
        this.active = conn
        if (m.file !== s.file) {
          s.text = null
          s.diagnostics = []
          s.errors = null
        }
        s.file = m.file
        s.line = m.line
        s.col = m.col
        break
      case 'doc':
        if (m.file !== s.file) return
        if (s.text !== null && s.text !== m.text) s.lastEditAt = now
        s.text = m.text
        break
      case 'diagnostics': {
        if (m.file !== s.file) return
        s.diagnostics = m.items
        const key = errorKey(m.items)
        s.errors = !key ? null : s.errors?.key === key ? s.errors : { key, since: now }
        break
      }
      case 'step_done':
        s.stepsDone.add(m.stepId)
        break
    }
    this.onChange()
  }
}
