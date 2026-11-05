import { useState } from 'react'
import { MessageSquare, PanelLeft, Pin, PinOff, Settings } from 'lucide-react'
import { ProjectIcon } from './sidebar'
import { projectKind } from '../../../../shared/workspace'
import type { ProjectInfo } from '../../../../shared/ipc'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export function TitleBar({
  project,
  sessionTitle,
  atHome,
  onOpenSettings,
  sidebar
}: {
  project: ProjectInfo | null
  /** The open session's title, shown after the project: "project › session". */
  sessionTitle?: string
  atHome?: boolean
  onOpenSettings: () => void
  /** Wide layout only: the sidebar toggle (⌘B). */
  sidebar?: { open: boolean; toggle: () => void }
}) {
  const [pinned, setPinned] = useState(false)
  const isMac = window.bettercoder.platform === 'darwin'

  async function togglePin() {
    setPinned(await window.bettercoder.setPinned(!pinned))
  }

  return (
    <header
      className={cn(
        'app-drag flex h-10 shrink-0 items-center gap-2.5 border-b border-divider bg-chrome px-3',
        isMac ? 'pl-[76px]' : 'pr-[140px]'
      )}
    >
      {sidebar && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="app-no-drag"
              aria-label={sidebar.open ? 'Close sidebar' : 'Open sidebar'}
              aria-pressed={sidebar.open}
              onClick={sidebar.toggle}
            >
              <PanelLeft />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{sidebar.open ? 'Close sidebar' : 'Open sidebar'} (⌘B)</TooltipContent>
        </Tooltip>
      )}
      <span className="font-mono text-xs font-medium text-heading">bettercoder</span>
      {/* Where you are, as project (a folder) › session (a conversation in it); the folder path is on hover. */}
      {atHome || !project ? (
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">home</span>
      ) : (
        <span
          className="flex min-w-0 flex-1 items-center gap-1.5 text-xs"
          title={project.root ? project.root.replace(/^\/Users\/[^/]+/, '~') : 'No folder yet'}
        >
          <ProjectIcon kind={projectKind(project)} className="text-muted-foreground" />
          <span className="max-w-[40%] shrink-0 truncate text-muted-foreground">{project.name}</span>
          {sessionTitle && (
            <>
              <span className="text-muted-foreground/60" aria-hidden="true">
                ›
              </span>
              <MessageSquare className="size-3.5 shrink-0 text-brand-text" aria-hidden="true" />
              <span className="min-w-0 truncate font-medium text-heading">{sessionTitle}</span>
            </>
          )}
        </span>
      )}
      <div className="app-no-drag flex items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Settings" onClick={onOpenSettings}>
              <Settings />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Settings</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={pinned ? 'Unpin from top' : 'Keep on top'}
              aria-pressed={pinned}
              onClick={togglePin}
              className={cn(pinned && 'text-brand-text')}
            >
              {pinned ? <Pin /> : <PinOff />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{pinned ? 'Unpin from top' : 'Keep on top'}</TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}
