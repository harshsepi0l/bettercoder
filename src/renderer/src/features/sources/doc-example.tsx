import { useEffect, useState } from 'react'
import { BadgeCheck } from 'lucide-react'
import type { DocExample } from '../../../../shared/map'
import type { SkillLevel } from '../../../../shared/profile'
import { cn } from '@/lib/utils'

const cache = new Map<string, Promise<DocExample | null>>()

export function loadDocExample(url: string, term: string): Promise<DocExample | null> {
  const key = `${url}\n${term}`
  let p = cache.get(key)
  if (!p) {
    p = window.codeMap.docExample(url, term).catch(() => null)
    cache.set(key, p)
  }
  return p
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** The official example for a method, or null while loading, offline, or when the page has none. */
export function useDocExample(url: string | undefined, term: string | undefined): DocExample | null {
  const [example, setExample] = useState<DocExample | null>(null)
  useEffect(() => {
    let live = true
    setExample(null)
    if (url && term) void loadDocExample(url, term).then((e) => live && setExample(e))
    return () => {
      live = false
    }
  }, [url, term])
  return example
}

export const docHost = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/**
 * A few lines of the official example for a concept, so the learner need not read the whole page.
 * Fetched by the app from the doc itself; nothing here is written by the coach. How much shows depends on
 * their level in the topic: one line when new, a few lines and the signature at basics, the signature for pros.
 */
export function DocExampleView({ url, term, level = 'basics', className }: { url: string; term: string; level?: SkillLevel; className?: string }) {
  const [example, setExample] = useState<DocExample | null>(null)
  // 0: as their level shows it · 1: the short example · 2: the whole example
  const [more, setMore] = useState(0)

  useEffect(() => {
    let live = true
    setExample(null)
    setMore(0)
    void loadDocExample(url, term).then((e) => live && setExample(e))
    return () => {
      live = false
    }
  }, [url, term])

  if (!example || example.excerpt.length === 0) return null
  const oneLine = level === 'new' && more === 0 && example.focus !== undefined
  const hidden = level === 'pro' && more === 0
  const lines = more === 2 && example.full ? example.full : oneLine ? [example.excerpt[example.focus!].trim()] : example.excerpt
  const focus = more === 2 ? -1 : oneLine ? 0 : example.focus
  const next =
    oneLine || hidden
      ? { label: 'Show the example', to: 1 }
      : more < 2 && example.full
        ? { label: `Show full example (${example.full.length} lines)`, to: 2 }
        : null

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
        <BadgeCheck className="size-3 text-status-done" aria-hidden="true" />
        OFFICIAL EXAMPLE · {host(example.url)}
      </div>
      {example.signature && level !== 'new' && (
        <code className="block overflow-x-auto whitespace-pre rounded-md border px-2.5 py-1.5 font-mono text-[11.5px] text-heading">
          {example.signature}
        </code>
      )}
      {!hidden && (
        <pre className="m-0 max-h-80 overflow-auto rounded-md bg-muted py-2 font-mono text-[11.5px] leading-relaxed">
          {lines.map((line, i) => (
            <div key={i} className={cn('px-2.5', i === focus && lines.length > 1 && 'border-l-2 border-brand-line bg-brand-text/10 pl-2')}>
              {line || ' '}
            </div>
          ))}
        </pre>
      )}
      {next && (
        <button
          type="button"
          onClick={() => {
            setMore(next.to)
            if (next.to === 2) void window.harness.cardUse('example_full')
          }}
          className="self-start text-[11.5px] text-brand-text underline-offset-2 hover:underline"
        >
          {next.label}
        </button>
      )}
      {more > 0 && (
        <button type="button" onClick={() => setMore(0)} className="self-start text-[11.5px] text-muted-foreground underline-offset-2 hover:underline">
          Show less
        </button>
      )}
    </div>
  )
}
