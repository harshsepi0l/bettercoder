import { useState } from 'react'
import { FolderOpen, Lightbulb, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import type { Workspace } from '@/features/workspace/use-workspace'
import { relativeTime } from '@/features/shell/sidebar'

const IDEAS = ['My first website', 'A game in Python', 'A Discord bot', 'A budget tracker']

/** Start here: bring code you have, or start from nothing. */
export function Home({
  workspace,
  hasModel,
  onOpenSettings,
  ideaRef
}: {
  workspace: Workspace
  hasModel: boolean
  onOpenSettings: () => void
  ideaRef?: React.Ref<HTMLTextAreaElement>
}) {
  const [idea, setIdea] = useState('')
  const [starting, setStarting] = useState(false)
  const recent = workspace.projects
    .flatMap((p) => p.sessions.map((s) => ({ ...s, project: p.name })))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 3)

  async function start() {
    if (!idea.trim() || starting) return
    setStarting(true)
    await workspace.startIdea(idea.trim())
    setStarting(false)
    setIdea('')
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-7 px-6 py-10">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[26px] font-semibold tracking-tight text-heading">What are we working on?</h1>
          <p className="text-[14px] text-muted-foreground">Bring code you have, or start from nothing.</p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <section className="flex flex-col gap-3.5 rounded-xl border bg-card p-5" aria-labelledby="have-code">
            <FolderOpen className="size-6 text-brand-text" aria-hidden="true" />
            <div className="flex flex-col gap-1">
              <h2 id="have-code" className="text-[16px] font-semibold text-heading">
                I have code
              </h2>
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                Open a project folder or a few files. Your coach reads them; it never changes them.
              </p>
            </div>
            <div className="flex-1" />
            <div className="flex flex-wrap gap-2">
              <Button size="lg" onClick={() => workspace.open('folder')}>
                Open folder
              </Button>
              <Button variant="outline" size="lg" onClick={() => workspace.open('files')}>
                Open files
              </Button>
            </div>
          </section>

          <section className="flex flex-col gap-3.5 rounded-xl border border-brand-line/70 bg-card p-5" aria-labelledby="start-new">
            <Lightbulb className="size-6 text-brand-text" aria-hidden="true" />
            <div className="flex flex-col gap-1">
              <h2 id="start-new" className="text-[16px] font-semibold text-heading">
                Start something new
              </h2>
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                Describe your idea. Your coach helps you plan it and set up, step by step.
              </p>
            </div>
            <Label htmlFor="idea" className="sr-only">
              Your idea
            </Label>
            <Textarea
              id="idea"
              ref={ideaRef}
              rows={3}
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void start()
              }}
              placeholder="e.g. An app that tracks my daily habits and shows streaks"
              className="resize-none bg-background text-[13.5px]"
            />
            <div className="flex flex-wrap gap-1.5">
              {IDEAS.map((i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setIdea(i)}
                  className="h-8 rounded-full border bg-background px-3 text-[12.5px] outline-none hover:border-muted-foreground/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {i}
                </button>
              ))}
            </div>
            {hasModel ? (
              <Button size="lg" className="self-start" disabled={!idea.trim() || starting} onClick={start}>
                Plan it with my coach
              </Button>
            ) : (
              <Button size="lg" variant="outline" className="self-start" onClick={onOpenSettings}>
                <Settings />
                Connect a model first
              </Button>
            )}
          </section>
        </div>

        {recent.length > 0 && (
          <section className="flex flex-col gap-2" aria-labelledby="recent">
            <h2 id="recent" className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
              PICK UP WHERE YOU LEFT OFF
            </h2>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              {recent.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => workspace.openSession(s.id)}
                  className="flex flex-col gap-0.5 rounded-lg border bg-chrome px-3.5 py-3 text-left outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <span className="truncate text-[13px] text-heading">{s.title}</span>
                  <span className="truncate text-[11.5px] text-muted-foreground">
                    {s.project} · {relativeTime(s.updatedAt)}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </ScrollArea>
  )
}
