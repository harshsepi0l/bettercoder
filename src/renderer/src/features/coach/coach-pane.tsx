import { useMemo } from 'react'
import type { ProjectInfo } from '../../../../shared/ipc'
import { CoachTab } from '@/features/project/coach-tab'
import { TaskToasts } from '@/features/tasks/tasks-tab'
import { IdeMeterRow, useIde } from './ide-meter'
import type { Coach } from './use-coach'

/**
 * The coach, beside the learner's work: always on the right, whichever tab is open on the left. One slim row (how it
 * is going), then one chat, with task notifications over its top (the tasks themselves are a tab). The newest step
 * card ticks off the lines they have written in the editor.
 */
export function CoachPane({
  project,
  coach,
  hasModel,
  onOpenProject,
  onOpenSettings,
  onViewTasks,
  children
}: {
  project: ProjectInfo | null
  coach: Coach
  hasModel: boolean
  onOpenProject: () => void
  onOpenSettings: () => void
  /** Open the Tasks tab (from a notification). */
  onViewTasks: () => void
  /** The composer. */
  children?: React.ReactNode
}) {
  const ide = useIde()
  const step = useMemo(() => {
    const item = coach.items.findLast((x) => x.kind === 'card' && x.card.kind === 'step')
    return item?.kind === 'card' && item.card.kind === 'step' ? { id: item.id, lines: item.card.lines.length } : null
  }, [coach.items])
  // Written lines, as VS Code reports them while they type.
  const written = step ? (ide.stepDone ? step.lines : Math.min(ide.typed, step.lines)) : 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {project?.root && <IdeMeterRow busy={coach.busy} onSend={coach.send} />}
      {/* The chat, with task notifications over its top (below the row above). */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {project?.root && <TaskToasts onView={onViewTasks} />}
        <CoachTab
          project={project}
          onOpenProject={onOpenProject}
          coach={coach}
          hasModel={hasModel}
          onOpenSettings={onOpenSettings}
          inPane
          typed={step ? { id: step.id, n: written } : undefined}
        />
      </div>
      {children}
    </div>
  )
}
