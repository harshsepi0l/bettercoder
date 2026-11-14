import { useMemo } from 'react'
import type { CoachIntent, CoachMode } from '../../../../shared/harness'
import type { ProjectInfo } from '../../../../shared/ipc'
import { CoachTab } from '@/features/project/coach-tab'
import { TaskToasts } from '@/features/tasks/tasks-tab'
import { CoachActions, useIde } from './ide-meter'
import { ModeBar } from './mode-bar'
import type { Coach } from './use-coach'

/**
 * The coach, beside the learner's VS Code. Its modes are at the top: Chat is the one and only chat (the conversation,
 * the composer, task notifications, Get a hint / Next step); Tasks, Visualize, Map and Sources each fill the pane with
 * their view and no chat. The newest step card ticks off the lines they have written in the editor.
 */
export function CoachPane({
  project,
  coach,
  hasModel,
  onOpenProject,
  onOpenSettings,
  mode,
  onModeChange,
  locked,
  panel,
  onSend,
  children
}: {
  project: ProjectInfo | null
  coach: Coach
  hasModel: boolean
  onOpenProject: () => void
  onOpenSettings: () => void
  mode: CoachMode
  onModeChange: (mode: CoachMode) => void
  locked: CoachMode[]
  /** The open mode's view (Tasks, the whiteboard, the Map, Sources); none in Chat. */
  panel: React.ReactNode
  onSend: (text: string, intent?: CoachIntent) => void
  /** The composer (Chat only). */
  children?: React.ReactNode
}) {
  const ide = useIde()
  const step = useMemo(() => {
    const item = coach.items.findLast((x) => x.kind === 'card' && x.card.kind === 'step')
    return item?.kind === 'card' && item.card.kind === 'step' ? { id: item.id, lines: item.card.lines.length } : null
  }, [coach.items])
  // Written lines, as VS Code reports them while they type.
  const written = step ? (ide.stepDone ? step.lines : Math.min(ide.typed, step.lines)) : 0
  const chat = mode === 'chat' || !project

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {project && <ModeBar mode={mode} onChange={onModeChange} locked={locked} />}
      {chat ? (
        <>
          {project?.root && <CoachActions busy={coach.busy} onSend={onSend} />}
          {/* The chat, with task notifications over its top. */}
          <div className="relative flex min-h-0 flex-1 flex-col">
            {project?.root && <TaskToasts onView={() => onModeChange('tasks')} />}
            <CoachTab
              project={project}
              onOpenProject={onOpenProject}
              coach={coach}
              hasModel={hasModel}
              onOpenSettings={onOpenSettings}
              typed={step ? { id: step.id, n: written } : undefined}
            />
          </div>
          {children}
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">{panel}</div>
      )}
    </div>
  )
}
