import { Component, useEffect, useMemo, useRef, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { AlertTriangle, Check, FileText, Loader2, X } from 'lucide-react'
import { coachTurns, questionStates } from '../../../../shared/chat'
import type { ChatItem } from './use-coach'
import { CardView } from './cards'

export function ChatView({
  items,
  busy,
  onAnswer,
  typed
}: {
  items: ChatItem[]
  busy: boolean
  onAnswer: (text: string) => void
  /** The newest step card, and how many of its lines they have written in the editor (ticked off on the card). */
  typed?: { id: string; n: number }
}) {
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [items, busy])

  // Worked out once per change to the chat, not on every render (a streamed reply re-renders per token).
  const { answers, latestPseudo, hidden, turns } = useMemo(() => {
    const answers = questionStates(items)
    return {
      answers,
      latestPseudo: items.findLast((x) => x.kind === 'card' && x.card.kind === 'pseudocode')?.id,
      // An answer given by clicking a card shows on the card, so its chat bubble is hidden.
      hidden: new Set([...answers.values()].map((a) => a.answerIndex).filter((i): i is number => i !== undefined)),
      turns: coachTurns(items)
    }
  }, [items])

  const renderItem = (item: ChatItem, i: number) => {
    if (hidden.has(i)) return null
    if (item.kind === 'card') {
      const a = answers.get(item.id)
      return (
        <CardBoundary key={`card-${item.id}`}>
          <CardView card={item.card} answer={a?.answer} active={!!a?.open && !busy} latest={item.id === latestPseudo} onAnswer={onAnswer} typed={item.id === typed?.id ? typed.n : undefined} />
        </CardBoundary>
      )
    }
    return <ChatRow key={`${item.kind}-${item.id}`} item={item} />
  }

  return (
    <div className="flex flex-col gap-3.5" aria-live="polite">
      {turns.map((turn) =>
        turn.user ? (
          renderItem(items[turn.from], turn.from)
        ) : (
          // Everything the coach says in one turn sits in one card with a maroon hue, so it reads as the coach.
          <div key={`turn-${items[turn.from].id}`} className={COACH_CARD}>
            {items.slice(turn.from, turn.to).map((item, k) => renderItem(item, turn.from + k))}
          </div>
        )
      )}
      {busy && items.at(-1)?.kind !== 'assistant' && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          Thinking…
        </div>
      )}
      <div ref={end} />
    </div>
  )
}

const COACH_CARD =
  'flex flex-col gap-3 rounded-xl border border-brand-line/25 bg-gradient-to-b from-brand-tint/70 to-brand-tint/20 p-3 shadow-[inset_2px_0_0_var(--brand-line)]'

/** One broken card must never take the session down with it: it shows a short notice instead. */
class CardBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    console.error('[bettercoder] a card failed to draw:', error)
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-[12px] text-muted-foreground">
        <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
        This card couldn't be shown.
      </div>
    )
  }
}

function ChatRow({ item }: { item: Exclude<ChatItem, { kind: 'card' }> }) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="max-w-[85%] self-end rounded-lg border bg-card px-3 py-2 text-[13px] whitespace-pre-wrap text-heading select-text">{item.text}</div>
      )
    case 'assistant':
      return (
        <div className="prose-coach text-[13.5px] leading-relaxed select-text">
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children }) => (
                <a href={href} target="_blank" rel="noreferrer" className="text-brand-text underline underline-offset-2">
                  {children}
                </a>
              ),
              code: ({ children }) => <code className="rounded border bg-card px-1 py-px font-mono text-[12px] text-heading">{children}</code>,
              p: ({ children }) => <p className="my-1.5">{children}</p>,
              ul: ({ children }) => <ul className="my-1.5 list-disc pl-5">{children}</ul>,
              ol: ({ children }) => <ol className="my-1.5 list-decimal pl-5">{children}</ol>,
              strong: ({ children }) => <strong className="font-semibold text-heading">{children}</strong>
            }}
          >
            {item.text}
          </Markdown>
        </div>
      )
    case 'tool':
      return (
        <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
          {item.status === 'running' ? (
            <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          ) : item.status === 'error' ? (
            <X className="size-3 text-status-missing" aria-hidden="true" />
          ) : (
            <Check className="size-3 text-status-done" aria-hidden="true" />
          )}
          <FileText className="size-3" aria-hidden="true" />
          <span>
            {item.label} {item.detail}
          </span>
          {item.status === 'error' && <span className="text-status-missing">refused</span>}
        </div>
      )
    case 'notice':
      return (
        <div className="flex items-start gap-2 rounded-md border border-status-missing/50 bg-status-missing/10 px-3 py-2 text-[12px] leading-relaxed text-status-missing">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{item.text}</span>
        </div>
      )
  }
}
