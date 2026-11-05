import type { ChatItem } from './chat'
import type { TurnUsage } from './harness'
import type { ProjectInfo } from './ipc'

/**
 * Session → Project → Coach, Visualize, Map, Sources.
 * A project is a folder on disk (or a set of files). The Map belongs to the project and
 * build up across sessions. Each session has its own Coach chat and Sources.
 */

export const WORKSPACE_IPC = {
  list: 'workspace:list',
  open: 'workspace:open',
  newSession: 'workspace:new-session',
  openSession: 'workspace:open-session',
  renameSession: 'workspace:rename-session',
  deleteSession: 'workspace:delete-session',
  deleteProject: 'workspace:delete-project',
  startIdea: 'workspace:start-idea',
  linkFolder: 'workspace:link-folder',
  changed: 'workspace:changed'
} as const

export interface SessionSummary {
  id: string
  projectId: string
  title: string
  createdAt: number
  updatedAt: number
}

/** What kind of project it is, from its folder and files: the one rule the sidebar and the title bar share. */
export function projectKind(p: { root: string; files?: readonly string[] }): ProjectSummary['kind'] {
  return !p.root ? 'idea' : p.files ? 'files' : 'folder'
}

export interface ProjectSummary {
  id: string
  name: string
  root: string
  /** A whole folder, individually opened files, or an idea with no folder yet. */
  kind: 'folder' | 'files' | 'idea'
  sessions: SessionSummary[]
}

/** Everything the panel needs to show one open session. */
export interface OpenSession {
  project: ProjectInfo & { id: string }
  session: SessionSummary & { items: ChatItem[]; usage: TurnUsage | null }
}

export interface WorkspaceApi {
  list(): Promise<ProjectSummary[]>
  /** Pick a folder or one or more files; opens that project and starts a new session. Null if cancelled. */
  open(mode?: 'folder' | 'files'): Promise<OpenSession | null>
  /** Start a project from an idea (no folder yet); the idea is sent to the coach as the first message. */
  startIdea(idea: string): Promise<OpenSession>
  /** Pick the folder for an idea project. Null if cancelled. */
  linkFolder(projectId: string): Promise<OpenSession | null>
  newSession(projectId: string): Promise<OpenSession>
  openSession(sessionId: string): Promise<OpenSession>
  renameSession(sessionId: string, title: string): Promise<void>
  deleteSession(sessionId: string): Promise<void>
  /** Forget a project and delete all its sessions (your files are never touched). */
  deleteProject(projectId: string): Promise<void>
  /** Fires when projects or sessions are added, renamed or updated. */
  onChanged(listener: () => void): () => void
}
