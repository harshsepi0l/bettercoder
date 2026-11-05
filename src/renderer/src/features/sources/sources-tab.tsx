import { useEffect, useMemo, useState } from 'react'
import { BookOpen, ExternalLink, Loader2, MessageSquare } from 'lucide-react'
import type { ChatItem } from '../../../../shared/chat'
import type { ProjectInfo } from '../../../../shared/ipc'
import type { DocLink } from '../../../../shared/map'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { EmptyState } from '@/features/shell/empty-state'
import { DocExampleView } from './doc-example'

interface SessionLink {
  title: string
  url: string
  /** What the coach said around it, or the concept it explained. */
  context: string
  /** The concept a concept card explained, for its official example. */
  term?: string
}

/** Doc links the coach gave in this session: concept cards and links in its replies. */
export function linksFromChat(items: ChatItem[]): SessionLink[] {
  const out: SessionLink[] = []
  const seen = new Set<string>()
  const add = (l: SessionLink) => {
    const url = l.url.replace(/[).,;]+$/, '')
    if (!/^https:\/\//.test(url) || seen.has(url)) return
    seen.add(url)
    out.push({ ...l, url })
  }
  for (const item of items) {
    if (item.kind === 'card' && item.card.kind === 'step') {
      const { idea, lines } = item.card
      if (idea?.docUrl) add({ title: idea.docTitle ?? idea.term, url: idea.docUrl, context: idea.term, term: idea.term })
      for (const l of lines) if (l.method && l.docUrl) add({ title: l.method, url: l.docUrl, context: item.card.title, term: l.method })
    } else if (item.kind === 'card' && item.card.kind === 'concept' && item.card.docUrl) {
      add({ title: item.card.docTitle ?? item.card.term, url: item.card.docUrl, context: item.card.term, term: item.card.term })
    } else if (item.kind === 'assistant') {
      const headline = item.text.split('\n')[0].replace(/\*/g, '').trim()
      for (const m of item.text.matchAll(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g)) add({ title: m[1], url: m[2], context: headline })
      const withoutMd = item.text.replace(/\[[^\]]+\]\((https:\/\/[^)\s]+)\)/g, '')
      for (const m of withoutMd.matchAll(/https:\/\/[^\s)>\]]+/g)) add({ title: new URL(m[0]).hostname, url: m[0], context: headline })
    }
  }
  return out
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

const stackCache = new Map<string, DocLink[]>()

function SourceRow({
  title,
  url,
  note,
  official,
  term,
  onAsk
}: {
  title: string
  url: string
  note: string
  official?: boolean
  term?: string
  onAsk: () => void
}) {
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border bg-card px-3.5 py-3">
    <div className="flex items-start gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-heading">{title}</span>
          {official && (
            <Badge variant="outline" className="shrink-0 border-status-done/50 text-[10px] text-status-done">
              official
            </Badge>
          )}
        </div>
        <span className="truncate font-mono text-[11px] text-brand-text">{host(url)}</span>
        <span className="truncate text-[12px] text-muted-foreground">{note}</span>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button variant="ghost" size="icon-sm" aria-label={`Ask the coach about ${title}`} title="Ask the coach how this applies to your code" onClick={onAsk}>
          <MessageSquare />
        </Button>
        <Button variant="outline" size="sm" onClick={() => window.open(url, '_blank')}>
          <ExternalLink />
          Open
        </Button>
      </div>
    </div>
      {term && <DocExampleView url={url} term={term} />}
    </div>
  )
}

/** Sources: links from this session's coaching, and official docs for what the project uses. */
export function SourcesTab({
  project,
  items,
  onAsk
}: {
  project: ProjectInfo | null
  items: ChatItem[]
  onAsk: (text: string) => void
}) {
  const key = project ? `${project.root}|${project.files?.join(',') ?? ''}` : ''
  const [stack, setStack] = useState<DocLink[] | null>(() => stackCache.get(key) ?? null)
  const session = useMemo(() => linksFromChat(items), [items])

  useEffect(() => {
    if (!project) return
    if (stackCache.has(key)) {
      setStack(stackCache.get(key)!)
      return
    }
    setStack(null)
    void window.codeMap
      .stackDocs()
      .then((d) => {
        stackCache.set(key, d)
        setStack(d)
      })
      .catch(() => setStack([]))
  }, [key, project])

  if (!project) {
    return (
      <EmptyState icon={BookOpen} title="Sources">
        Open a folder or files. Docs for what your code uses, and links the coach gives you, collect here.
      </EmptyState>
    )
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-3.5">
        <section className="flex flex-col gap-2">
          <h2 className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">FROM THIS SESSION</h2>
          {session.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground">No links yet. Docs the coach points you to will appear here.</p>
          ) : (
            session.map((l) => (
              <SourceRow
                key={l.url}
                title={l.title}
                url={l.url}
                note={l.context}
                term={l.term}
                onAsk={() => onAsk(`Which part of "${l.title}" (${l.url}) matters for my code, and what should I look for?`)}
              />
            ))
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">DOCS FOR WHAT YOUR PROJECT USES</h2>
          {stack === null ? (
            <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              Reading your imports…
            </p>
          ) : stack.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground">No known libraries found in your imports.</p>
          ) : (
            stack.map((d) => (
              <SourceRow
                key={d.url}
                title={d.title}
                url={d.url}
                note={d.reason}
                official={d.official}
                onAsk={() => onAsk(`I use ${d.reason.replace(/^you import /, '')}. What in "${d.title}" should I read first for my project?`)}
              />
            ))
          )}
        </section>
      </div>
    </ScrollArea>
  )
}
