import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import type { ProjectSummary, SessionSummary } from '../../../../shared/workspace'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { useConfirmDelete } from './confirm-delete'
import type { Workspace } from './use-workspace'

/** Rename / delete for one session. */
export function SessionMenu({
  session,
  workspace,
  onRename,
  className
}: {
  session: Pick<SessionSummary, 'id' | 'title'>
  workspace: Workspace
  onRename: () => void
  className?: string
}) {
  const confirm = useConfirmDelete()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={`Actions for session ${session.title}`} className={className}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DropdownMenuItem onSelect={onRename}>
          <Pencil />
          Rename
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={() =>
            confirm({
              title: 'Delete this session?',
              description: `"${session.title}" and its chat will be deleted. This can't be undone. Your project files are not touched.`,
              confirmLabel: 'Delete session',
              onConfirm: () => workspace.deleteSession(session.id)
            })
          }
        >
          <Trash2 />
          Delete session
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** New session / delete everything for one project. */
export function ProjectMenu({
  project,
  workspace,
  className
}: {
  project: ProjectSummary
  workspace: Workspace
  className?: string
}) {
  const confirm = useConfirmDelete()
  const count = project.sessions.length
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={`Actions for project ${project.name}`} className={cn(className)}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DropdownMenuItem onSelect={() => workspace.newSession(project.id)}>
          <Plus />
          New session
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={() =>
            confirm({
              title: `Delete ${project.name}?`,
              description: `All ${count} session${count === 1 ? '' : 's'} for ${project.name} will be deleted, along with their chats. This can't be undone. The ${project.kind === 'files' ? 'files' : 'folder'} on your computer ${project.kind === 'files' ? 'are' : 'is'} not touched.`,
              confirmLabel: 'Delete project',
              onConfirm: () => workspace.deleteProject(project.id)
            })
          }
        >
          <Trash2 />
          Delete project and sessions
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
