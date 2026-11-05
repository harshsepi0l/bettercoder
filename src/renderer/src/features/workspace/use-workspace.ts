import { useCallback, useEffect, useState } from 'react'
import type { OpenSession, ProjectSummary } from '../../../../shared/workspace'

function message(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/** Projects and their sessions, and which session is open. */
export function useWorkspace() {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [active, setActive] = useState<OpenSession | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => setProjects(await window.workspace.list()), [])

  useEffect(() => {
    void refresh()
    const offChanged = window.workspace.onChanged(() => void refresh())
    const offEvents = window.harness.onEvent((e) => {
      if (e.type === 'session_opened') setActive(e.open)
      else if (e.type === 'session_closed') setActive(null)
    })
    return () => {
      offChanged()
      offEvents()
    }
  }, [refresh])

  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(message(err))
    }
  }, [])

  return {
    projects,
    active,
    error,
    clearError: () => setError(null),
    open: (mode?: 'folder' | 'files') => run(() => window.workspace.open(mode)),
    startIdea: (idea: string) => run(() => window.workspace.startIdea(idea)),
    linkFolder: (projectId: string) => run(() => window.workspace.linkFolder(projectId)),
    newSession: (projectId: string) => run(() => window.workspace.newSession(projectId)),
    openSession: (sessionId: string) => run(() => window.workspace.openSession(sessionId)),
    renameSession: (sessionId: string, title: string) =>
      run(async () => {
        await window.workspace.renameSession(sessionId, title)
        setActive((a) => (a && a.session.id === sessionId ? { ...a, session: { ...a.session, title } } : a))
      }),
    deleteSession: (sessionId: string) => run(() => window.workspace.deleteSession(sessionId)),
    deleteProject: (projectId: string) => run(() => window.workspace.deleteProject(projectId))
  }
}

export type Workspace = ReturnType<typeof useWorkspace>
