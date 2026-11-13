import { BookOpen, Code2, ListChecks, Map, MessageSquare, PenLine, type LucideIcon } from 'lucide-react'
import type { CoachIntent } from '../../../../shared/harness'
import type { TaskView } from '../../../../shared/tasks'
import { TasksTab } from '@/features/tasks/tasks-tab'
import { MapTab } from '@/features/map/map-tab'
import { SourcesTab } from '@/features/sources/sources-tab'
import { VisualizeTab } from '@/features/visualize/visualize-tab'
import type { ProjectInfo } from '../../../../shared/ipc'
import { CoachTab } from '@/features/project/coach-tab'
import { CodeSurface } from '@/features/code/vscode-frame'
import type { Coach } from '@/features/coach/use-coach'

export type SectionId = 'code' | 'coach' | 'tasks' | 'visualize' | 'map' | 'sources'

/**
 * Inside a session. Code is the learner's editor; Coach, Tasks and Sources belong to the session; the Map to the project.
 * Beside the editor, the coach has its own pane on the right, so it is not a tab there (see layoutSections).
 */
export const SECTIONS: Array<{ id: SectionId; label: string; icon: LucideIcon }> = [
  { id: 'code', label: 'Code', icon: Code2 },
  { id: 'coach', label: 'Coach', icon: MessageSquare },
  { id: 'tasks', label: 'Tasks', icon: ListChecks },
  { id: 'visualize', label: 'Visualize', icon: PenLine },
  { id: 'map', label: 'Map', icon: Map },
  { id: 'sources', label: 'Sources', icon: BookOpen }
]

/**
 * Which tabs show. Wide: Code, Tasks, Visualize, Map, Sources (the coach is the right pane). Narrow: the coach becomes
 * a tab of its own.
 */
export function layoutSections(opts: { wide: boolean }): SectionId[] {
  return opts.wide ? ['code', 'tasks', 'visualize', 'map', 'sources'] : ['code', 'coach', 'tasks', 'visualize', 'map', 'sources']
}

export function SectionContent({
  section,
  sessionKey,
  project,
  onOpenProject,
  coach,
  hasModel,
  onOpenSettings,
  onAsk,
  onAskTask,
  onViewTasks,
  onPickFolder
}: {
  section: SectionId
  /** The open session, so the Code tab starts fresh for each. */
  sessionKey: string
  project: ProjectInfo | null
  onOpenProject: () => void
  coach: Coach
  hasModel: boolean
  onOpenSettings: () => void
  /** Send something to the coach and switch to it (from Map and Sources). */
  onAsk: (text: string, intent?: CoachIntent) => void
  /** Ask the coach about one task in their own words (the composer takes it and is shown). */
  onAskTask: (task: TaskView) => void
  /** Open the Tasks tab (from a task notification). */
  onViewTasks: () => void
  /** Pick a folder for a project that has none (an idea), from the Code tab. */
  onPickFolder: () => void
}) {
  switch (section) {
    case 'code':
      return <CodeSurface sessionKey={sessionKey} root={project?.root ?? ''} onPickFolder={onPickFolder} />
    case 'coach':
      return (
        <CoachTab
          project={project}
          onOpenProject={onOpenProject}
          coach={coach}
          hasModel={hasModel}
          onOpenSettings={onOpenSettings}
          onViewTasks={onViewTasks}
        />
      )
    case 'tasks':
      return <TasksTab busy={coach.busy} onSend={onAsk} onAsk={onAskTask} />
    case 'visualize':
      return <VisualizeTab items={coach.items} busy={coach.busy} onAsk={onAsk} />
    case 'map':
      return <MapTab project={project} onAsk={onAsk} />
    case 'sources':
      return <SourcesTab project={project} items={coach.items} onAsk={onAsk} />
  }
}
