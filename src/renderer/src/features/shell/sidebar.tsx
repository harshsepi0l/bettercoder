import { useState } from 'react'
import { Files, FolderOpen, FolderPlus, Home, Lightbulb, MessageSquare, Plus, Settings } from 'lucide-react'
import { STYLES, type LearnerProfile } from '../../../../shared/profile'
import type { ProjectSummary } from '../../../../shared/workspace'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { ProjectMenu, SessionMenu } from '@/features/workspace/menus'
import type { Workspace } from '@/features/workspace/use-workspace'
export function relativeTime(ts: number): string {
  const mins = Math.round((Date.now() - ts) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'yesterday' : `${days}d ago`
}

export interface SidebarProps {
  workspace: Workspace
  /** Home is showing (instead of a session). */
  atHome: boolean
  onHome: () => void
  /** Go Home with the idea box focused. */
  onNewIdea: () => void
  profile: LearnerProfile | null
  onOpenProfile: () => void
}

/** A project's icon: folder, files or idea (also the title bar's). */
export function ProjectIcon({ kind, className }: { kind: ProjectSummary['kind']; className?: string }) {
  const Icon = kind === 'idea' ? Lightbulb : kind === 'files' ? Files : FolderOpen
  return <Icon className={cn('size-3.5 shrink-0 text-brand-text', className)} aria-hidden="true" />
}

function NewMenu({ workspace, onNewIdea, compact }: { workspace: Workspace; onNewIdea: () => void; compact?: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {compact ? (
          <Button size="icon" aria-label="New">
            <Plus />
          </Button>
        ) : (
          <Button className="w-full">
            <Plus />
            New
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side={compact ? 'right' : 'bottom'} className="w-52">
        <DropdownMenuItem onSelect={onNewIdea}>
          <Lightbulb />
          Start something new
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => workspace.open('folder')}>
          <FolderOpen />
          Open folder
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => workspace.open('files')}>
          <Files />
          Open files
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** "Getting to know you" until the coach has seen something, then how many topics it has judged. */
export function profileSummary(profile: LearnerProfile): { level: string; style: string } {
  const n = profile.skills.length
  const level = n === 0 ? 'Getting to know you' : `${n} topic${n === 1 ? '' : 's'} seen`
  const words = profile.styles.map((id) => STYLES.find((s) => s.id === id)!.label.split(' ')[0].toLowerCase())
  const style = words.length ? words.join(' · ') : profile.notes ? 'your own words' : 'default style'
  return { level, style }
}

/** Sidebar closed: a narrow rail of icons. */
export function SidebarRail({ workspace, atHome, onHome, onNewIdea, profile, onOpenProfile }: SidebarProps) {
  const activeProject = workspace.active?.project.id
  return (
    <nav aria-label="Sidebar (closed)" className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-divider bg-chrome py-2">
      <NewMenu workspace={workspace} onNewIdea={onNewIdea} compact />
      <RailButton label="Home" active={atHome} onClick={onHome}>
        <Home />
      </RailButton>
      <div className="my-1.5 h-px w-7 bg-divider" />
      <span className="font-mono text-[8.5px] tracking-[0.08em] text-muted-foreground">PROJECTS</span>
      <ScrollArea className="min-h-0 w-full flex-1">
        <div className="flex flex-col items-center gap-1 pt-1">
          {workspace.projects.map((p) => (
            <ProjectFlyout
              key={p.id}
              project={p}
              active={!atHome && p.id === activeProject}
              openSessionId={atHome ? undefined : workspace.active?.session.id}
              onOpen={(id) => workspace.openSession(id)}
              onNew={() => workspace.newSession(p.id)}
            />
          ))}
        </div>
      </ScrollArea>
      {profile && (
        <RailButton label={`You: ${profileSummary(profile).level}`} onClick={onOpenProfile}>
          <Settings />
        </RailButton>
      )}
    </nav>
  )
}

/**
 * A project's block in the narrow rail: clicking it opens a list of its sessions to the right (plus a new one), so a
 * narrow window can still reach every session. Before, the block only ever reopened the newest session.
 */
function ProjectFlyout({
  project,
  active,
  openSessionId,
  onOpen,
  onNew
}: {
  project: ProjectSummary
  active: boolean
  openSessionId?: string
  onOpen: (sessionId: string) => void
  onNew: () => void
}) {
  const [all, setAll] = useState(false)
  return (
    <DropdownMenu onOpenChange={(o) => !o && setAll(false)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`${project.name} project, ${count(project.sessions.length)}`}
              aria-current={active ? 'page' : undefined}
              className={cn('relative size-11 flex-col gap-0.5', active && RAIL_ACTIVE)}
            >
              {/* A project is a folder; the badge counts its sessions (conversations). */}
              <ProjectIcon kind={project.kind} className="size-4 text-current" />
              <span className="font-mono text-[10px] leading-none lowercase">{project.name.slice(0, 2)}</span>
              <span
                className={cn(
                  'absolute top-0 right-0 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5 font-mono text-[9px] leading-none',
                  active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                )}
                aria-hidden="true"
              >
                {project.sessions.length}
              </span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">{project.name}</TooltipContent>
      </Tooltip>
      {/* Don't hand focus back to the block on close: it stayed outlined (and showed its tooltip) as if still pressed. */}
      <DropdownMenuContent side="right" align="start" sideOffset={6} className="w-72" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DropdownMenuLabel className="flex items-center gap-2 border-b pb-2">
          <ProjectIcon kind={project.kind} className="size-4.5" />
          <span className="flex min-w-0 flex-col">
            <span className="bc-label">PROJECT</span>
            <span className="truncate text-[13.5px] text-heading">{project.name}</span>
          </span>
        </DropdownMenuLabel>
        <div className="px-2 pt-1.5 pb-1 bc-label">
          SESSIONS IN THIS PROJECT · {project.sessions.length}
        </div>
        <div className="max-h-72 overflow-y-auto">
          {(all ? project.sessions : project.sessions.slice(0, FIRST)).map((s) => {
            const open = s.id === openSessionId
            return (
              <DropdownMenuItem
                key={s.id}
                onSelect={() => onOpen(s.id)}
                className={cn('gap-2', open && 'bg-brand-tint text-heading shadow-[inset_2px_0_0_var(--brand-line)]')}
              >
                <MessageSquare className={cn('size-3.5', open ? 'text-brand-text' : 'text-muted-foreground')} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{s.title}</span>
                <span className="shrink-0 text-[10.5px] text-muted-foreground">{open ? 'open' : relativeTime(s.updatedAt)}</span>
              </DropdownMenuItem>
            )
          })}
          {!all && project.sessions.length > FIRST && (
            // Stays open: shows the rest in place.
            <DropdownMenuItem onSelect={(e) => (e.preventDefault(), setAll(true))} className="pl-7.5 text-[12.5px] text-muted-foreground">
              Show {project.sessions.length - FIRST} more
            </DropdownMenuItem>
          )}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onNew} className="text-brand-text">
          <Plus />
          New session in this project
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The look of the open project or page in the narrow rail. */
const RAIL_ACTIVE = 'bg-accent text-heading ring-1 ring-brand-line/60'

/** Sessions shown in a project's flyout before "Show N more". */
const FIRST = 4
const count = (n: number) => `${n} ${n === 1 ? 'session' : 'sessions'}`

function RailButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          aria-current={active ? 'page' : undefined}
          onClick={onClick}
          className={cn('size-10', active && RAIL_ACTIVE)}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

/** Sidebar open: New, Home, projects with their sessions, and who you are. */
export function Sidebar({ workspace, atHome, onHome, onNewIdea, profile, onOpenProfile }: SidebarProps) {
  const activeId = atHome ? undefined : workspace.active?.session.id
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null)

  function commitRename() {
    if (editing && editing.title.trim()) void workspace.renameSession(editing.id, editing.title.trim())
    setEditing(null)
  }

  const summary = profile ? profileSummary(profile) : null

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-divider bg-chrome">
      <div className="flex flex-col gap-1 px-2 pt-2.5 pb-2">
        <NewMenu workspace={workspace} onNewIdea={onNewIdea} />
        <button
          type="button"
          aria-current={atHome ? 'page' : undefined}
          onClick={onHome}
          className={cn(
            'mt-1 flex h-8 items-center gap-2 rounded-md px-2 text-[12.5px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
            atHome ? 'bg-accent text-heading' : 'hover:bg-accent/50'
          )}
        >
          <Home className={cn('size-3.5', atHome ? 'text-brand-text' : 'text-muted-foreground')} aria-hidden="true" />
          Home
        </button>
      </div>

      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <span className="bc-label">PROJECTS</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label="Open a folder or files" onClick={() => workspace.open()}>
              <FolderPlus />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Open a folder or files</TooltipContent>
        </Tooltip>
      </div>

      <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block">
        <div className="flex flex-col gap-3 px-2 pb-3">
          {workspace.projects.length === 0 && (
            <p className="px-1 py-2 text-[12px] leading-relaxed text-muted-foreground">
              Nothing yet. Start from Home: open your code, or describe something new.
            </p>
          )}
          {workspace.projects.map((p) => (
            <section key={p.id} className="flex flex-col gap-0.5" aria-label={`Project ${p.name}`}>
              <div className="group flex items-center gap-1.5 px-1.5 py-1">
                <ProjectIcon kind={p.kind} />
                <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-heading" title={p.root || p.name}>
                  {p.name}
                </span>
                {p.kind === 'idea' && (
                  <span className="rounded border px-1 text-[10px] text-muted-foreground" title="No folder linked yet">
                    idea
                  </span>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon-xs" aria-label={`New session in ${p.name}`} onClick={() => workspace.newSession(p.id)}>
                      <Plus />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>New session</TooltipContent>
                </Tooltip>
                <ProjectMenu project={p} workspace={workspace} className="text-muted-foreground" />
              </div>
              {p.sessions.length === 0 && (
                <p className="py-1 pl-7 text-[11px] text-muted-foreground">No sessions. Use + to start one.</p>
              )}
              {p.sessions.map((s) => {
                const active = s.id === activeId
                if (editing?.id === s.id) {
                  return (
                    <form
                      key={s.id}
                      className="py-0.5 pr-1 pl-5"
                      onSubmit={(e) => {
                        e.preventDefault()
                        commitRename()
                      }}
                    >
                      <label htmlFor={`rename-${s.id}`} className="sr-only">
                        Session title
                      </label>
                      <Input
                        id={`rename-${s.id}`}
                        autoFocus
                        value={editing.title}
                        onChange={(e) => setEditing({ id: s.id, title: e.target.value })}
                        onBlur={commitRename}
                        onKeyDown={(e) => e.key === 'Escape' && setEditing(null)}
                        className="h-7 bg-muted text-[12.5px]"
                      />
                    </form>
                  )
                }
                return (
                  <div key={s.id} className={cn('group flex items-center rounded-md transition-colors', active ? 'bg-accent' : 'hover:bg-accent/50')}>
                    <button
                      type="button"
                      aria-current={active ? 'page' : undefined}
                      onClick={() => workspace.openSession(s.id)}
                      onDoubleClick={() => setEditing({ id: s.id, title: s.title })}
                      className="flex min-w-0 flex-1 items-start gap-2 rounded-md py-1.5 pr-1 pl-5 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <MessageSquare className={cn('mt-0.5 size-3.5 shrink-0', active ? 'text-brand-text' : 'text-muted-foreground')} aria-hidden="true" />
                      <span className="flex min-w-0 flex-col">
                        <span className={cn('truncate text-[12.5px]', active ? 'text-heading' : 'text-foreground')}>{s.title}</span>
                        <span className="text-[10.5px] text-muted-foreground">{relativeTime(s.updatedAt)}</span>
                      </span>
                    </button>
                    <SessionMenu
                      session={s}
                      workspace={workspace}
                      onRename={() => setEditing({ id: s.id, title: s.title })}
                      className={cn('mr-1', !active && 'text-muted-foreground')}
                    />
                  </div>
                )
              })}
            </section>
          ))}
        </div>
      </ScrollArea>

      {summary && (
        <div className="border-t border-divider p-2">
          <button
            type="button"
            onClick={onOpenProfile}
            aria-label={`You: ${summary.level}, ${summary.style}. Open settings`}
            className="flex w-full items-center gap-2.5 rounded-lg border bg-background p-2 text-left outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[12.5px] text-heading">{summary.level}</span>
              <span className="truncate text-[11px] text-muted-foreground">{summary.style}</span>
            </span>
            <Settings className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        </div>
      )}
    </aside>
  )
}
