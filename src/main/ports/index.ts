import type { ChatItem } from '../../shared/chat'
import type { ProjectInfo } from '../../shared/ipc'
import type { CodeMap } from '../../shared/map'
import type { ScenarioCall, Trace } from '../../shared/trace'
import type { IdeDiagnostic, ToIde } from '../../shared/ide'
import type { ProjectSummary, SessionSummary } from '../../shared/workspace'

/**
 * Ports: what the coach and the services need from the outside world, as interfaces only. Adapters and engines
 * implement them; ipc/ports.ts plugs the real ones in. So the conversation and the workspace never touch files,
 * processes, sockets or Electron themselves, and tests can hand them stand-ins (tests/architecture.test.ts).
 */

// ── The learner's project (read-only) ──────────────────────────────

export interface FileEntry {
  name: string
  isDir: boolean
  isFile: boolean
}

/** Read-only access to the learner's project. There is no method that writes. */
export interface ProjectFiles {
  /** The gate: a path inside root (symlinks included), not a secret file, and in `allowed` when set; else throws. */
  resolve(root: string, input: string, allowed?: ReadonlySet<string>): Promise<{ abs: string; rel: string }>
  /** Entries of a folder already resolved through `resolve`. */
  list(abs: string): Promise<FileEntry[]>
  info(abs: string): Promise<{ isFile: boolean; size: number }>
  read(abs: string): Promise<Uint8Array>
}


// ── Animator ───────────────────────────────────────────────────────

export interface RunRequest {
  root: string
  /** Set for sessions opened on individual files. */
  files?: string[]
  /** The Python file to load, relative to root. */
  file: string
  scenario: ScenarioCall[]
}

export interface Animator {
  /** Run the learner's own file (on a sandboxed temp copy) and record every step. */
  run(req: RunRequest): Promise<Trace>
  /** Run a small Python example the coach wrote, in a temp folder; its code is never returned. */
  runExample(python: string): Promise<Trace>
}

// ── Code map and project scan ──────────────────────────────────────

export interface CodeMapper {
  build(project: ProjectInfo): Promise<CodeMap>
}

export interface ProjectScanner {
  scanFolder(root: string): Promise<ProjectInfo>
  scanFiles(paths: string[]): Promise<ProjectInfo>
  /** 'missing' when nothing is there. */
  kindOf(path: string): Promise<'dir' | 'file' | 'missing'>
}

// ── Projects and sessions on disk ──────────────────────────────────

export interface ProjectRecord {
  id: string
  root: string
  name: string
  /** Set when the project is a set of individually opened files (relative to root). */
  files?: string[]
  /** Set for projects started from an idea. root stays '' until the learner links a folder. */
  idea?: string
  createdAt: number
}

export interface SessionRecord extends SessionSummary {
  /** Only in sessions saved before the move to pi-durable: their chat, shown read-only. */
  items?: ChatItem[]
}

export interface SessionStore {
  upsertProject(root: string, name: string, files?: string[]): Promise<ProjectRecord>
  createIdeaProject(name: string, idea: string): Promise<ProjectRecord>
  linkFolder(id: string, root: string): Promise<ProjectRecord>
  getProject(id: string): Promise<ProjectRecord | null>
  createSession(projectId: string): Promise<SessionRecord>
  saveSession(record: SessionRecord): Promise<void>
  getSession(sessionId: string): Promise<SessionRecord | null>
  /** The session's conversation database file (pi-durable SQLite). */
  sessionDbFile(record: Pick<SessionRecord, 'id' | 'projectId'>): string
  deleteSession(sessionId: string): Promise<void>
  deleteProject(projectId: string): Promise<void>
  list(): Promise<ProjectSummary[]>
}

// ── The editor ─────────────────────────────────────────────────────

/** What one editor window last reported. */
export interface EditorSnapshot {
  ide: string
  folders: string[]
  file: string | null
  line: number
  col: number
  /** The open file's text as the editor has it (unsaved edits included), when it is `file`. */
  text: string | null
  diagnostics: IdeDiagnostic[]
  /** When they last changed the text (ms). */
  lastEditAt: number | null
  /** The current set of errors, and since when it has been the same. */
  errors: { key: string; since: number } | null
  /** Step ids the editor reported as fully typed. */
  stepsDone: Set<string>
  /** How many pseudocode lines of a step they have typed so far (the editor reports it as they write). */
  stepTyped: { stepId: string; n: number } | null
}

/** The live line to the learner's editor. */
export interface EditorFeed {
  snapshot(): EditorSnapshot | null
  send(message: ToIde): void
}

// ── The learner's terminals (theirs alone: the coach never types or reads a shell) ──

export interface TerminalSpawn {
  /** The program to start for a Run (an interpreter, a compiler's shell line, dotnet, …). */
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
  cols: number
  rows: number
}

/** Real terminals (a pseudo-terminal each), so input(), colours, Ctrl+C and full-screen programs work. */
export interface Terminals {
  /** Start a process in a new terminal; returns its id. Throws if it can't start. */
  spawn(opts: TerminalSpawn): string
  write(id: string, data: string): void
  resize(id: string, cols: number, rows: number): void
  /** End the process and everything it started. */
  kill(id: string): void
  onData(listener: (id: string, data: string) => void): () => void
  onExit(listener: (id: string, exitCode: number | null, signal: number | null) => void): () => void
}

/** Everything the coach needs from outside, in one bundle. */
export interface CoachPorts {
  files: ProjectFiles
  animator: Animator
  mapper: CodeMapper
}
