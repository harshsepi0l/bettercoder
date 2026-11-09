import { BookOpen, Clapperboard, Code2, Map, MessageSquare, type LucideIcon } from 'lucide-react'
import type { CoachIntent } from '../../../../shared/harness'
import { MapTab } from '@/features/map/map-tab'
import { SourcesTab } from '@/features/sources/sources-tab'
import { VisualizeTab } from '@/features/visualize/visualize-tab'
import type { ProjectInfo } from '../../../../shared/ipc'
import { CoachTab } from '@/features/project/coach-tab'
import { CodeSurface } from '@/features/code/vscode-frame'
import type { Coach } from '@/features/coach/use-coach'

export type SectionId = 'code' | 'coach' | 'visualize' | 'map' | 'sources'

/**
 * Inside a session. Code is the learner's editor; Coach and Sources belong to the session; the Map to the project.
 * Beside the editor, the coach has its own pane on the right, so it is not a tab there (see layoutSections).
 */
export const SECTIONS: Array<{ id: SectionId; label: string; icon: LucideIcon }> = [
  { id: 'code', label: 'Code', icon: Code2 },
  { id: 'coach', label: 'Coach', icon: MessageSquare },
  { id: 'visualize', label: 'Visualize', icon: Clapperboard },
  { id: 'map', label: 'Map', icon: Map },
  { id: 'sources', label: 'Sources', icon: BookOpen }
]

/**
 * Which tabs show. Wide: Code, Visualize, Map, Sources (the coach is the right pane). Narrow: Code and Coach become
 * tabs of their own.
 */
export function layoutSections(opts: { wide: boolean }): SectionId[] {
  return opts.wide ? ['code', 'visualize', 'map', 'sources'] : ['code', 'coach', 'visualize', 'map', 'sources']
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
        />
      )
    case 'visualize':
      return <VisualizeTab project={project} items={coach.items} />
    case 'map':
      return <MapTab project={project} onAsk={onAsk} />
    case 'sources':
      return <SourcesTab project={project} items={coach.items} onAsk={onAsk} />
  }
}
