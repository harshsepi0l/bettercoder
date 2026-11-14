import type { CoachIntent, CoachMode } from '../../../../shared/harness'
import type { TaskView } from '../../../../shared/tasks'
import type { ChatItem } from '../../../../shared/chat'
import type { ProjectInfo } from '../../../../shared/ipc'
import { TasksTab } from '@/features/tasks/tasks-tab'
import { MapTab } from '@/features/map/map-tab'
import { SourcesTab } from '@/features/sources/sources-tab'
import { VisualizeTab } from '@/features/visualize/visualize-tab'

/** A mode's view, filling the coach pane (Chat has none: it is the chat). */
export function ModePanel({
  mode,
  project,
  items,
  busy,
  onAsk,
  onAskTask
}: {
  mode: CoachMode
  project: ProjectInfo | null
  items: ChatItem[]
  busy: boolean
  /** Send something to the coach, in this mode. */
  onAsk: (text: string, intent?: CoachIntent) => void
  /** Ask the coach about one task in their own words (the composer takes it). */
  onAskTask: (task: TaskView) => void
}) {
  switch (mode) {
    case 'chat':
      return null
    case 'tasks':
      return <TasksTab busy={busy} onSend={onAsk} onAsk={onAskTask} />
    case 'visualize':
      return <VisualizeTab items={items} busy={busy} onAsk={onAsk} />
    case 'map':
      return <MapTab project={project} onAsk={onAsk} />
    case 'sources':
      return <SourcesTab project={project} items={items} onAsk={onAsk} />
  }
}
