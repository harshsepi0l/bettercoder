import { FolderOpen, GitBranch, MessageSquare, Search, Settings } from 'lucide-react'
import type { ProjectInfo } from '../../../../shared/ipc'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { EmptyState } from '@/features/shell/empty-state'
import { ChatView } from '@/features/coach/chat-view'
import type { Coach } from '@/features/coach/use-coach'

export function CoachTab({
  project,
  onOpenProject,
  coach,
  hasModel,
  onOpenSettings,
  typed
}: {
  project: ProjectInfo | null
  onOpenProject: () => void
  coach: Coach
  hasModel: boolean
  onOpenSettings: () => void
  /** The newest step card and how many of its lines they have written. */
  typed?: { id: string; n: number }
}) {
  if (!project) {
    return (
      <EmptyState
        icon={FolderOpen}
        title="Open something to begin"
        action={
          <Button onClick={onOpenProject} className="mt-1">
            <FolderOpen />
            Open folder or files
          </Button>
        }
      >
        Pick the folder you're working in, or just the files you want help with. You write the code; the coach only
        reads it and never changes a file.
      </EmptyState>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative flex min-h-0 flex-1 flex-col">
        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-3.5">
            {coach.items.length === 0 && project.root ? <ProjectCard project={project} /> : <ProjectLine project={project} />}
            {coach.items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <MessageSquare className="size-5 text-muted-foreground" aria-hidden="true" />
                {hasModel ? (
                  <p className="max-w-[300px] text-[13px] leading-relaxed text-muted-foreground">
                    Ask about your project, or tell the coach where you're stuck. It can read your files, but it will never
                    write code for you.
                  </p>
                ) : (
                  <>
                    <p className="max-w-[300px] text-[13px] leading-relaxed text-muted-foreground">
                      Connect a model to start: sign in with Grok, or add an API key.
                    </p>
                    <Button size="sm" onClick={onOpenSettings}>
                      <Settings />
                      Open settings
                    </Button>
                  </>
              )}
            </div>
          ) : (
            <ChatView items={coach.items} busy={coach.busy} onAnswer={coach.send} typed={typed} />
          )}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}

/** Once the chat has started, the project shrinks to one quiet line. */
function ProjectLine({ project }: { project: ProjectInfo }) {
  if (!project.root) {
    return (
      <div className="flex items-center gap-2 font-mono text-[10.5px] text-muted-foreground">
        <Search className="size-3 text-brand-text" aria-hidden="true" />
        <span className="text-foreground">{project.name}</span>
        <span>· idea · no folder linked yet</span>
      </div>
    )
  }
  const parts = [
    project.stacks.join(', ') || 'stack not recognised',
    project.files ? `${project.files.length} opened file${project.files.length === 1 ? '' : 's'}` : `${project.fileCount} files`,
    project.git ? `branch ${project.git.branch ?? 'detached'}` : 'no git'
  ]
  return (
    <div className="flex items-center gap-2 font-mono text-[10.5px] text-muted-foreground">
      <Search className="size-3 text-brand-text" aria-hidden="true" />
      <span className="text-foreground">{project.name}</span>
      <span>· {parts.join(' · ')} · read-only</span>
    </div>
  )
}

function ProjectCard({ project }: { project: ProjectInfo }) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border bg-muted p-3">
      <div className="flex items-center gap-2 bc-label">
        <Search className="size-3 text-brand-text" aria-hidden="true" />
        DETECTED · READ-ONLY
      </div>
      <dl className="grid grid-cols-[84px_minmax(0,1fr)] gap-y-1.5 text-xs">
        <dt className="text-muted-foreground">{project.files ? 'Opened' : 'Project'}</dt>
        <dd className="truncate font-mono text-heading">{project.name}</dd>
        {project.files && (
          <>
            <dt className="text-muted-foreground">Can see</dt>
            <dd className="flex flex-col font-mono">
              {project.files.map((f) => (
                <span key={f} className="truncate">
                  {f}
                </span>
              ))}
              <span className="font-sans text-[11px] text-muted-foreground">Only these files, nothing else in the folder.</span>
            </dd>
          </>
        )}
        <dt className="text-muted-foreground">Stack</dt>
        <dd className="flex flex-wrap gap-1">
          {project.stacks.length > 0 ? (
            project.stacks.map((s) => (
              <Badge key={s} variant="outline" className="border-brand-line/60 text-brand-text">
                {s}
              </Badge>
            ))
          ) : (
            <span className="text-muted-foreground">Not recognised yet</span>
          )}
        </dd>
        <dt className="text-muted-foreground">Files</dt>
        <dd className="truncate">
          {project.languages.length > 0
            ? project.languages.map((l) => `${l.files} ${l.name}`).join(' · ')
            : `${project.fileCount} files, no source code yet`}
        </dd>
        <dt className="text-muted-foreground">Git</dt>
        <dd className="flex items-center gap-1 font-mono">
          {project.git ? (
            <>
              <GitBranch className="size-3" aria-hidden="true" />
              {project.git.branch ?? 'detached HEAD'}
            </>
          ) : (
            <span className="font-sans text-muted-foreground">None (that's fine)</span>
          )}
        </dd>
      </dl>
    </section>
  )
}
