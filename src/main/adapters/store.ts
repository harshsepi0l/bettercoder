import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { projectKind, type ProjectSummary, type SessionSummary } from '../../shared/workspace'
import type { ProjectRecord, SessionRecord, SessionStore, StoredTask } from '../ports'

/**
 * BetterCoder's own records, stored as JSON in the app's data folder (never in
 * the user's project):
 *
 *   <dataDir>/projects/<projectId>/project.json
 *   <dataDir>/projects/<projectId>/sessions/<sessionId>.json     title, timestamps
 *   <dataDir>/projects/<projectId>/sessions/<sessionId>.sqlite   the conversation (pi-durable)
 *   <dataDir>/projects/<projectId>/sessions/<sessionId>.tasks    its tasks (JSON)
 *
 * The Map is read from the code on demand; nothing project-level is stored yet.
 */

async function writeJson(file: string, value: unknown): Promise<void> {
  const tmp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`
  await writeFile(tmp, JSON.stringify(value), { mode: 0o600 })
  await rename(tmp, file)
}

/** At most this many files are read at once when listing. */
const READ_LIMIT = 16

/** Like Promise.all over `items`, with at most `limit` running at once; results keep their order. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T
  } catch {
    return null
  }
}

/** Same folder (or same set of files) → same project id. */
export function projectIdFor(root: string, files?: string[]): string {
  const key = files ? `${root}\n${[...files].sort().join('\n')}` : root
  return createHash('sha256').update(key).digest('hex').slice(0, 16)
}

export class WorkspaceStore implements SessionStore {
  constructor(private readonly dataDir: string) {}

  private projectDir(id: string): string {
    return join(this.dataDir, 'projects', id)
  }
  private sessionsDir(projectId: string): string {
    return join(this.projectDir(projectId), 'sessions')
  }

  async upsertProject(root: string, name: string, files?: string[]): Promise<ProjectRecord> {
    const id = projectIdFor(root, files)
    await mkdir(this.sessionsDir(id), { recursive: true })
    const file = join(this.projectDir(id), 'project.json')
    const now = Date.now()
    const existing = await readJson<ProjectRecord>(file)
    const record: ProjectRecord = existing ? { ...existing, name } : { id, root, name, ...(files ? { files } : {}), createdAt: now }
    await writeJson(file, record)
    return record
  }

  /** A project that starts as an idea, with no folder yet. */
  async createIdeaProject(name: string, idea: string): Promise<ProjectRecord> {
    const id = projectIdFor(`idea:${randomUUID()}`)
    await mkdir(this.sessionsDir(id), { recursive: true })
    const record: ProjectRecord = { id, root: '', name, idea, createdAt: Date.now() }
    await writeJson(join(this.projectDir(id), 'project.json'), record)
    return record
  }

  /** Give an idea project its folder; its sessions carry on. */
  async linkFolder(id: string, root: string): Promise<ProjectRecord> {
    const p = await this.getProject(id)
    if (!p) throw new Error('That project is no longer known.')
    const record: ProjectRecord = { ...p, root }
    delete record.files
    await writeJson(join(this.projectDir(id), 'project.json'), record)
    return record
  }

  async getProject(id: string): Promise<ProjectRecord | null> {
    return readJson<ProjectRecord>(join(this.projectDir(id), 'project.json'))
  }

  async createSession(projectId: string): Promise<SessionRecord> {
    const now = Date.now()
    const record: SessionRecord = {
      id: randomUUID(),
      projectId,
      title: 'New session',
      createdAt: now,
      updatedAt: now
    }
    await this.saveSession(record)
    return record
  }

  async saveSession(record: SessionRecord): Promise<void> {
    await mkdir(this.sessionsDir(record.projectId), { recursive: true })
    await writeJson(join(this.sessionsDir(record.projectId), `${record.id}.json`), record)
  }

  /** Session ids are UUIDs; find the owning project by scanning (few projects, cheap). */
  async getSession(sessionId: string): Promise<SessionRecord | null> {
    if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return null
    for (const p of await this.projectIds()) {
      const s = await readJson<SessionRecord>(join(this.sessionsDir(p), `${sessionId}.json`))
      if (s) return s
    }
    return null
  }

  /** The session's conversation database (pi-durable SQLite). */
  sessionDbFile(record: Pick<SessionRecord, 'id' | 'projectId'>): string {
    return join(this.sessionsDir(record.projectId), `${record.id}.sqlite`)
  }

  /** Kept beside the session (not `.json`, so listing sessions never reads it as one). */
  private tasksFile(record: Pick<SessionRecord, 'id' | 'projectId'>): string {
    return join(this.sessionsDir(record.projectId), `${record.id}.tasks`)
  }

  async loadTasks(record: Pick<SessionRecord, 'id' | 'projectId'>): Promise<StoredTask[] | null> {
    const tasks = await readJson<StoredTask[]>(this.tasksFile(record))
    return Array.isArray(tasks) ? tasks.filter((t) => t && typeof t.id === 'string' && typeof t.title === 'string') : null
  }

  async saveTasks(record: Pick<SessionRecord, 'id' | 'projectId'>, tasks: readonly StoredTask[]): Promise<void> {
    await mkdir(this.sessionsDir(record.projectId), { recursive: true })
    await writeJson(this.tasksFile(record), tasks)
  }

  /** Forget a session's conversation (its pi-durable SQLite files); the session, its title and tasks stay. */
  async clearConversation(record: Pick<SessionRecord, 'id' | 'projectId'>): Promise<void> {
    const base = join(this.sessionsDir(record.projectId), record.id)
    for (const suffix of ['.sqlite', '.sqlite-wal', '.sqlite-shm']) await rm(`${base}${suffix}`, { force: true })
  }

  async deleteSession(sessionId: string): Promise<void> {
    const s = await this.getSession(sessionId)
    if (!s) return
    const base = join(this.sessionsDir(s.projectId), s.id)
    for (const suffix of ['.json', '.tasks', '.sqlite', '.sqlite-wal', '.sqlite-shm']) await rm(`${base}${suffix}`, { force: true })
  }

  /** Remove BetterCoder's own records for a project. The project's folder on disk is never touched. */
  async deleteProject(projectId: string): Promise<void> {
    if (!/^[0-9a-f]{16}$/.test(projectId)) return
    await rm(this.projectDir(projectId), { recursive: true, force: true })
  }

  private async projectIds(): Promise<string[]> {
    try {
      return (await readdir(join(this.dataDir, 'projects'), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name)
    } catch {
      return []
    }
  }

  /**
   * Projects, most recent activity first (their newest session's last message, else when the project was made), each
   * with its sessions (newest first). Opening a project or session never reorders the list (regression: opening one
   * sent its project to the top).
   */
  async list(): Promise<ProjectSummary[]> {
    // Read in parallel, a few files at a time (this runs after every message; too many open files at once would
    // fail and silently drop sessions from the list).
    const listed = await mapLimit(await this.projectIds(), READ_LIMIT, async (id) => {
      const p = await this.getProject(id)
      if (!p) return null
      const files = (await readdir(this.sessionsDir(id)).catch(() => [] as string[])).filter((f) => f.endsWith('.json'))
      const sessions: SessionSummary[] = (await mapLimit(files, READ_LIMIT, (f) => readJson<SessionRecord>(join(this.sessionsDir(id), f))))
        .filter((s): s is SessionRecord => !!s)
        .map((s) => ({ id: s.id, projectId: s.projectId, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt }))
        .sort((a, b) => b.updatedAt - a.updatedAt)
      const summary: ProjectSummary = { id: p.id, name: p.name, root: p.root, kind: projectKind(p), sessions }
      return { summary, activity: Math.max(sessions[0]?.updatedAt ?? 0, p.createdAt) }
    })
    return listed
      .filter((x) => x !== null)
      .sort((a, b) => b.activity - a.activity)
      .map((x) => x.summary)
  }
}
