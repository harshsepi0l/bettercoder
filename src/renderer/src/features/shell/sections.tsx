import { BookOpen, Clapperboard, Map, MessageSquare, type LucideIcon } from 'lucide-react'
import type { CoachIntent } from '../../../../shared/harness'
import { MapTab } from '@/features/map/map-tab'
import { SourcesTab } from '@/features/sources/sources-tab'
import { VisualizeTab } from '@/features/visualize/visualize-tab'
import type { ProjectInfo } from '../../../../shared/ipc'
import { CoachTab } from '@/features/project/coach-tab'
import type { Coach } from '@/features/coach/use-coach'

export type SectionId = 'coach' | 'visualize' | 'map' | 'sources'

/** Inside a session. Coach and Sources belong to the session; the Map to the project. */
export const SECTIONS: Array<{ id: SectionId; label: string; icon: LucideIcon }> = [
  { id: 'coach', label: 'Coach', icon: MessageSquare },
  { id: 'visualize', label: 'Visualize', icon: Clapperboard },
  { id: 'map', label: 'Map', icon: Map },
  { id: 'sources', label: 'Sources', icon: BookOpen }
]

export function SectionContent({
  section,
  project,
  onOpenProject,
  coach,
  hasModel,
  onOpenSettings,
  onAsk
}: {
  section: SectionId
  project: ProjectInfo | null
  onOpenProject: () => void
  coach: Coach
  hasModel: boolean
  onOpenSettings: () => void
  /** Send something to the coach and switch to it (from Map and Sources). */
  onAsk: (text: string, intent?: CoachIntent) => void
}) {
  switch (section) {
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
