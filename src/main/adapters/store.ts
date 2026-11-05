import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProjectSummary, SessionSummary } from '../../shared/workspace'
import type { ProjectRecord, SessionRecord, SessionStore } from '../ports'

/**
 * BetterCoder's own records, stored as JSON in the app's data folder (never in
 * the user's project):
 *
 *   <dataDir>/projects/<projectId>/project.json
 *   <dataDir>/projects/<projectId>/sessions/<sessionId>.json     title, timestamps
 *   <dataDir>/projects/<projectId>/sessions/<sessionId>.sqlite   the conversation (pi-durable)
 *
 * The Map is read from the code on demand; nothing project-level is stored yet.
 */

export type { ProjectRecord, SessionRecord }

async function writeJson(file: string, value: unknown): Promise<void> {
  const tmp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`
  await writeFile(tmp, JSON.stringify(value), { mode: 0o600 })
  await rename(tmp, file)
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
    const record: ProjectRecord = existing
      ? { ...existing, name, lastOpenedAt: now }
      : { id, root, name, ...(files ? { files } : {}), createdAt: now, lastOpenedAt: now }
    await writeJson(file, record)
    return record
  }

  /** A project that starts as an idea, with no folder yet. */
  async createIdeaProject(name: string, idea: string): Promise<ProjectRecord> {
    const id = projectIdFor(`idea:${randomUUID()}`)
    await mkdir(this.sessionsDir(id), { recursive: true })
    const now = Date.now()
    const record: ProjectRecord = { id, root: '', name, idea, createdAt: now, lastOpenedAt: now }
    await writeJson(join(this.projectDir(id), 'project.json'), record)
    return record
  }

  /** Give an idea project its folder; its sessions carry on. */
  async linkFolder(id: string, root: string): Promise<ProjectRecord> {
    const p = await this.getProject(id)
    if (!p) throw new Error('That project is no longer known.')
    const record: ProjectRecord = { ...p, root, lastOpenedAt: Date.now() }
    delete record.files
    await writeJson(join(this.projectDir(id), 'project.json'), record)
    return record
  }

  async getProject(id: string): Promise<ProjectRecord | null> {
    return readJson<ProjectRecord>(join(this.projectDir(id), 'project.json'))
  }

  async touchProject(id: string): Promise<void> {
    const p = await this.getProject(id)
    if (p) await writeJson(join(this.projectDir(id), 'project.json'), { ...p, lastOpenedAt: Date.now() })
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

  async deleteSession(sessionId: string): Promise<void> {
    const s = await this.getSession(sessionId)
    if (!s) return
    const base = join(this.sessionsDir(s.projectId), s.id)
    for (const suffix of ['.json', '.sqlite', '.sqlite-wal', '.sqlite-shm']) await rm(`${base}${suffix}`, { force: true })
  }

  /** Remove BetterCoder's own records for a project. The project's folder on disk is never touched. */
  async deleteProject(projectId: string): Promise<void> {
    if (!/^[0-9a-f]{16}$/.test(projectId)) return
    await rm(this.projectDir(projectId), { recursive: true, force: true })
  }

  private async projectIds(): Promise<string[]> {
    try {
      return (await readdir(join(this.dataDir, 'projects'), { withFileTypes: true }))
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
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
    const out: ProjectSummary[] = []
    const created = new Map<string, number>()
    for (const id of await this.projectIds()) {
      const p = await this.getProject(id)
      if (!p) continue
      created.set(p.id, p.createdAt)
      const sessions: SessionSummary[] = []
      let files: string[] = []
      try {
        files = (await readdir(this.sessionsDir(id))).filter((f) => f.endsWith('.json'))
      } catch {
        files = []
      }
      for (const f of files) {
        const s = await readJson<SessionRecord>(join(this.sessionsDir(id), f))
        if (s) sessions.push({ id: s.id, projectId: s.projectId, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt })
      }
      sessions.sort((a, b) => b.updatedAt - a.updatedAt)
      out.push({
        id: p.id,
        name: p.name,
        root: p.root,
        kind: !p.root ? 'idea' : p.files ? 'files' : 'folder',
        lastOpenedAt: p.lastOpenedAt,
        sessions
      })
    }
    const activity = (p: ProjectSummary) => Math.max(p.sessions[0]?.updatedAt ?? 0, created.get(p.id) ?? 0)
    return out.sort((a, b) => activity(b) - activity(a))
  }
}
